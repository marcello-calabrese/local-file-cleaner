//! Single parallel directory walk.
//!
//! Each directory is read on a rayon worker and its subdirectories are walked
//! with `par_iter`, so work-stealing spreads the tree across all cores. The
//! recursion returns a per-directory summary, which gives recursive sizes for
//! cache folders and "is this subtree empty" for empty-folder detection
//! without a second pass.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rayon::prelude::*;

use crate::cache_dirs::CacheRules;
use crate::filters::{is_cloud_placeholder, is_system_file, Exclusions};
use crate::{unix_secs, CacheDir, EmptyDir, FileEntry, ScanContext, ScanOptions};

pub(crate) struct WalkOutput {
    /// Files outside cache folders (cache contents are reported as a whole).
    pub files: Vec<FileEntry>,
    pub caches: Vec<CacheDir>,
    pub empty_dirs: Vec<EmptyDir>,
    pub files_total: u64,
    pub bytes_total: u64,
}

#[derive(Debug, Clone, Copy)]
struct DirSummary {
    size: u64,
    files: u64,
    /// No files and nothing but empty folders below it.
    empty: bool,
    /// Empty folders in this subtree, itself included.
    empty_count: u64,
}

impl DirSummary {
    /// For folders we could not (or chose not to) look into.
    const OPAQUE: Self = Self { size: 0, files: 0, empty: false, empty_count: 0 };
}

struct Walker<'a> {
    opts: &'a ScanOptions,
    ctx: &'a ScanContext,
    exclusions: Exclusions,
    cache_rules: CacheRules,
    files: Mutex<Vec<FileEntry>>,
    caches: Mutex<Vec<CacheDir>>,
    empty_dirs: Mutex<Vec<EmptyDir>>,
}

pub(crate) fn walk(roots: &[PathBuf], opts: &ScanOptions, ctx: &ScanContext) -> WalkOutput {
    let walker = Walker {
        opts,
        ctx,
        exclusions: Exclusions::new(&opts.excludes, opts.skip_system),
        cache_rules: CacheRules::from_env(),
        files: Mutex::new(Vec::new()),
        caches: Mutex::new(Vec::new()),
        empty_dirs: Mutex::new(Vec::new()),
    };
    let summaries: Vec<DirSummary> =
        roots.par_iter().map(|root| walker.walk_dir(root, false, true)).collect();

    let mut caches = walker.caches.into_inner().unwrap();
    caches.sort_by(|a, b| b.size.cmp(&a.size));
    let mut empty_dirs = walker.empty_dirs.into_inner().unwrap();
    empty_dirs.sort_by(|a, b| a.path.cmp(&b.path));
    WalkOutput {
        files: walker.files.into_inner().unwrap(),
        caches,
        empty_dirs,
        files_total: summaries.iter().map(|s| s.files).sum(),
        bytes_total: summaries.iter().map(|s| s.size).sum(),
    }
}

impl Walker<'_> {
    fn walk_dir(&self, dir: &Path, in_cache: bool, is_root: bool) -> DirSummary {
        if self.ctx.is_cancelled() {
            return DirSummary::OPAQUE;
        }
        let read = match std::fs::read_dir(dir) {
            Ok(r) => r,
            Err(_) => {
                self.ctx.progress.add_error();
                return DirSummary::OPAQUE;
            }
        };
        self.ctx.progress.add_dir();

        let mut local_files = Vec::new();
        let mut subdirs = Vec::new();
        let mut size = 0u64;
        let mut file_count = 0u64;
        // Anything that makes this folder non-empty without being a walked
        // file or folder: links, excluded folders, unreadable entries.
        let mut has_other = false;

        for entry in read {
            let Ok(entry) = entry else {
                has_other = true;
                self.ctx.progress.add_error();
                continue;
            };
            let Ok(file_type) = entry.file_type() else {
                has_other = true;
                continue;
            };
            // Symlinks and junctions: never followed, never deleted through.
            if file_type.is_symlink() {
                has_other = true;
            } else if file_type.is_dir() {
                let path = entry.path();
                if self.exclusions.is_excluded_dir(&path) {
                    has_other = true;
                } else {
                    subdirs.push(path);
                }
            } else if file_type.is_file() {
                // On Windows this comes from the directory listing itself: no extra I/O.
                let Ok(meta) = entry.metadata() else {
                    has_other = true;
                    continue;
                };
                let len = meta.len();
                size += len;
                file_count += 1;
                let attrs = file_attributes(&meta);
                if in_cache || (self.exclusions.skip_system() && is_system_file(attrs)) {
                    continue;
                }
                local_files.push(FileEntry {
                    path: entry.path(),
                    size: len,
                    modified: unix_secs(meta.modified()),
                    accessed: unix_secs(meta.accessed()),
                    cloud_only: is_cloud_placeholder(attrs),
                });
            } else {
                has_other = true;
            }
        }
        self.ctx.progress.add_files(file_count, size);
        if !local_files.is_empty() {
            self.files.lock().unwrap().extend(local_files);
        }

        let children: Vec<(PathBuf, DirSummary, Option<&'static str>)> = subdirs
            .into_par_iter()
            .map(|path| {
                let kind = if in_cache || !self.opts.find_caches {
                    None
                } else {
                    self.cache_rules.classify(&path)
                };
                let summary = self.walk_dir(&path, in_cache || kind.is_some(), false);
                (path, summary, kind)
            })
            .collect();

        let mut summary = DirSummary {
            size,
            files: file_count,
            empty: file_count == 0 && !has_other,
            empty_count: 0,
        };
        for (_, child, _) in &children {
            summary.size += child.size;
            summary.files += child.files;
            summary.empty &= child.empty;
            summary.empty_count += child.empty_count;
        }
        if summary.empty {
            summary.empty_count += 1;
        }

        if !in_cache {
            self.report_children(&children, summary.empty && !is_root);
        }
        summary
    }

    /// Records cache folders, and the topmost empty folders: when this folder
    /// is itself empty its parent reports it instead of its children.
    fn report_children(
        &self,
        children: &[(PathBuf, DirSummary, Option<&'static str>)],
        self_is_empty: bool,
    ) {
        for (path, child, kind) in children {
            if let Some(kind) = kind {
                if child.size >= self.opts.min_cache_size && child.files > 0 {
                    self.caches.lock().unwrap().push(CacheDir {
                        path: path.to_string_lossy().into_owned(),
                        kind: (*kind).to_string(),
                        size: child.size,
                        files: child.files,
                    });
                }
            } else if self.opts.find_empty_dirs && child.empty && !self_is_empty {
                self.empty_dirs.lock().unwrap().push(EmptyDir {
                    path: path.to_string_lossy().into_owned(),
                    nested: child.empty_count,
                });
            }
        }
    }
}

#[cfg(windows)]
fn file_attributes(meta: &std::fs::Metadata) -> u32 {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes()
}

#[cfg(not(windows))]
fn file_attributes(_meta: &std::fs::Metadata) -> u32 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn opts(root: &Path) -> ScanOptions {
        ScanOptions {
            roots: vec![root.to_path_buf()],
            min_cache_size: 0,
            ..Default::default()
        }
    }

    #[test]
    fn finds_topmost_empty_dirs_only() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join("a/b/c")).unwrap();
        fs::create_dir_all(root.join("a/d")).unwrap();
        fs::create_dir_all(root.join("keep/empty")).unwrap();
        fs::write(root.join("keep/file.txt"), b"x").unwrap();

        let out = walk(&[root.to_path_buf()], &opts(root), &ScanContext::new());
        let mut names: Vec<_> = out
            .empty_dirs
            .iter()
            .map(|e| (Path::new(&e.path).strip_prefix(root).unwrap().to_owned(), e.nested))
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![(PathBuf::from("a"), 4), (Path::new("keep").join("empty"), 1)]
        );
        assert_eq!(out.files.len(), 1);
    }

    #[test]
    fn cache_folders_are_sized_and_their_files_hidden() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join("proj/node_modules/pkg/empty")).unwrap();
        fs::write(root.join("proj/node_modules/pkg/index.js"), vec![0u8; 1000]).unwrap();
        fs::write(root.join("proj/node_modules/x.js"), vec![0u8; 500]).unwrap();
        fs::write(root.join("proj/main.js"), b"hi").unwrap();

        let out = walk(&[root.to_path_buf()], &opts(root), &ScanContext::new());
        assert_eq!(out.caches.len(), 1);
        assert_eq!(out.caches[0].size, 1500);
        assert_eq!(out.caches[0].files, 2);
        assert_eq!(out.caches[0].kind, "Node.js packages");
        // Only main.js is offered to the other analyses; the empty folder
        // inside node_modules is not reported separately.
        assert_eq!(out.files.len(), 1);
        assert!(out.empty_dirs.is_empty());
        assert_eq!(out.files_total, 3);
        assert_eq!(out.bytes_total, 1502);
    }

    #[test]
    fn excluded_folder_is_skipped_and_keeps_parent_non_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join("outer/private")).unwrap();
        fs::write(root.join("outer/private/secret.txt"), b"s").unwrap();
        let mut o = opts(root);
        o.excludes = vec![root.join("outer/private")];

        let out = walk(&[root.to_path_buf()], &o, &ScanContext::new());
        assert!(out.files.is_empty());
        assert!(out.empty_dirs.is_empty());
    }
}
