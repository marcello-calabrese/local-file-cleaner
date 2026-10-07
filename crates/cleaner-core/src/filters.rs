//! Decides which paths the scan must never touch.

use std::path::{Path, PathBuf};

/// Folders directly under a drive root that belong to Windows itself.
const SYSTEM_ROOT_DIRS: &[&str] = &[
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
    "$recycle.bin",
    "system volume information",
    "recovery",
    "$winreagent",
    "$windows.~bt",
    "$windows.~ws",
    "perflogs",
    "msocache",
    "config.msi",
];

// Win32 file attribute bits (winnt.h).
pub const ATTR_HIDDEN: u32 = 0x2;
pub const ATTR_SYSTEM: u32 = 0x4;
pub const ATTR_OFFLINE: u32 = 0x1000;
pub const ATTR_RECALL_ON_OPEN: u32 = 0x4_0000;
pub const ATTR_RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;

/// True for cloud placeholders (OneDrive "online-only" files and similar):
/// reading their content would trigger a download.
pub fn is_cloud_placeholder(attrs: u32) -> bool {
    attrs & (ATTR_OFFLINE | ATTR_RECALL_ON_OPEN | ATTR_RECALL_ON_DATA_ACCESS) != 0
}

/// Protected system files (desktop.ini, pagefile.sys, ...).
pub fn is_system_file(attrs: u32) -> bool {
    attrs & ATTR_SYSTEM != 0
}

/// Lowercased path with `\` separators and no trailing separator.
pub fn normalize(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('/', "\\").to_lowercase();
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}

/// `child` equals `parent` or is somewhere below it. Both must be normalized.
pub fn is_within(child: &str, parent: &str) -> bool {
    match child.strip_prefix(parent) {
        Some("") => true,
        Some(rest) => rest.starts_with('\\') || parent.ends_with('\\'),
        None => false,
    }
}

/// Drops duplicate roots and roots that live inside another root.
pub fn dedupe_roots(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut items: Vec<(String, &PathBuf)> = roots.iter().map(|r| (normalize(r), r)).collect();
    items.sort_by(|a, b| a.0.len().cmp(&b.0.len()));
    let mut kept: Vec<(String, &PathBuf)> = Vec::new();
    for (norm, path) in items {
        if !kept.iter().any(|(k, _)| is_within(&norm, k)) {
            kept.push((norm, path));
        }
    }
    kept.into_iter().map(|(_, p)| p.clone()).collect()
}

/// User excludes plus (optionally) Windows system folders.
#[derive(Debug, Default)]
pub struct Exclusions {
    excludes: Vec<String>,
    skip_system: bool,
}

impl Exclusions {
    pub fn new(excludes: &[PathBuf], skip_system: bool) -> Self {
        Self {
            excludes: excludes.iter().map(|p| normalize(p)).collect(),
            skip_system,
        }
    }

    pub fn skip_system(&self) -> bool {
        self.skip_system
    }

    pub fn is_excluded_dir(&self, path: &Path) -> bool {
        let norm = normalize(path);
        if self.excludes.iter().any(|e| is_within(&norm, e)) {
            return true;
        }
        self.skip_system && is_system_root_dir(&norm)
    }
}

/// `c:\windows`, `d:\$recycle.bin`, ... (only directly below a drive root).
fn is_system_root_dir(norm: &str) -> bool {
    let bytes = norm.as_bytes();
    let under_drive_root =
        bytes.len() > 3 && bytes[1] == b':' && bytes[2] == b'\\' && !norm[3..].contains('\\');
    under_drive_root && SYSTEM_ROOT_DIRS.contains(&&norm[3..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn within_respects_component_boundaries() {
        assert!(is_within(r"c:\users\a\docs", r"c:\users\a"));
        assert!(is_within(r"c:\users\a", r"c:\users\a"));
        assert!(!is_within(r"c:\users\ab", r"c:\users\a"));
        assert!(is_within(r"c:\users", r"c:\"));
    }

    #[test]
    fn dedupes_nested_roots() {
        let roots = vec![
            PathBuf::from(r"C:\Users\a\Pictures"),
            PathBuf::from(r"C:\Users\a"),
            PathBuf::from(r"c:\users\a\"),
            PathBuf::from(r"D:\Photos"),
        ];
        let out = dedupe_roots(&roots);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn system_dirs_only_at_drive_root() {
        let ex = Exclusions::new(&[], true);
        assert!(ex.is_excluded_dir(Path::new(r"C:\Windows")));
        assert!(ex.is_excluded_dir(Path::new(r"D:\$RECYCLE.BIN")));
        assert!(!ex.is_excluded_dir(Path::new(r"C:\Users\a\Windows")));
        let ex = Exclusions::new(&[PathBuf::from(r"C:\Users\a\Secret")], false);
        assert!(ex.is_excluded_dir(Path::new(r"C:\Users\a\secret\x")));
        assert!(!ex.is_excluded_dir(Path::new(r"C:\Windows")));
    }
}
