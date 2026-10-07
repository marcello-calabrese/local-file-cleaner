//! Scan engine for Local File Cleaner.
//!
//! A scan walks the selected roots once, in parallel, and then runs the
//! requested analyses (duplicates, similar images, cache folders, unused
//! files, empty folders) over that snapshot. Nothing here deletes anything
//! except [`delete::move_to_recycle_bin`], which is only called on explicit
//! user request.

pub mod cache_dirs;
pub mod delete;
pub mod duplicates;
pub mod filters;
pub mod platform;
pub mod progress;
pub mod similar;
pub mod thumbnail;
pub mod unused;
mod walker;

use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub use progress::{Phase, Progress, ProgressSnapshot, ScanContext};

/// File extensions treated as photos.
pub const PHOTO_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff", "heic", "heif", "avif", "cr2",
    "cr3", "nef", "arw", "dng", "orf", "rw2", "raf",
];

/// Subset of [`PHOTO_EXTENSIONS`] that can be decoded for similarity hashing.
pub const DECODABLE_EXTENSIONS: &[&str] =
    &["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScanOptions {
    pub roots: Vec<PathBuf>,
    pub excludes: Vec<PathBuf>,
    /// Skip Windows, Program Files, ProgramData, recycle bin, system files...
    pub skip_system: bool,

    pub find_duplicates: bool,
    /// Only compare photos (true) or every file (false).
    pub duplicates_photos_only: bool,

    pub find_similar: bool,
    /// Maximum Hamming distance between 64-bit perceptual hashes (0..=20).
    pub similarity_distance: u32,
    /// Where perceptual hashes are cached between scans.
    pub hash_cache_path: Option<PathBuf>,

    pub find_caches: bool,
    pub min_cache_size: u64,

    pub find_unused: bool,
    pub unused_months: u32,
    pub min_unused_size: u64,

    pub find_empty_dirs: bool,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            excludes: Vec::new(),
            skip_system: true,
            find_duplicates: true,
            duplicates_photos_only: true,
            find_similar: true,
            similarity_distance: 6,
            hash_cache_path: None,
            find_caches: true,
            min_cache_size: 10 * 1024 * 1024,
            find_unused: true,
            unused_months: 3,
            min_unused_size: 1024 * 1024,
            find_empty_dirs: true,
        }
    }
}

/// A regular file found during the walk.
#[derive(Debug, Clone)]
pub struct FileEntry {
    pub path: PathBuf,
    pub size: u64,
    /// Unix seconds.
    pub modified: i64,
    /// Unix seconds.
    pub accessed: i64,
    /// Cloud placeholder (e.g. OneDrive "online-only"): reading it would download it.
    pub cloud_only: bool,
}

/// A file as reported to the UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileItem {
    pub path: String,
    pub size: u64,
    pub modified: i64,
    pub accessed: i64,
}

impl From<&FileEntry> for FileItem {
    fn from(f: &FileEntry) -> Self {
        Self {
            path: f.path.to_string_lossy().into_owned(),
            size: f.size,
            modified: f.modified,
            accessed: f.accessed,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub hash: String,
    /// Size of each file in the group.
    pub size: u64,
    pub files: Vec<FileItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarImage {
    pub file: FileItem,
    pub width: u32,
    pub height: u32,
    /// Hamming distance to the group's reference image (0 = identical look).
    pub distance: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarGroup {
    pub images: Vec<SimilarImage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheDir {
    pub path: String,
    /// Human readable kind, e.g. "Node.js packages".
    pub kind: String,
    pub size: u64,
    pub files: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyDir {
    pub path: String,
    /// Number of empty folders inside it (it counts itself).
    pub nested: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    pub cloud_only_skipped: u64,
    pub errors: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub duplicates: Vec<DuplicateGroup>,
    pub similar: Vec<SimilarGroup>,
    pub caches: Vec<CacheDir>,
    pub unused: Vec<FileItem>,
    pub empty_dirs: Vec<EmptyDir>,
    pub stats: ScanStats,
}

#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    #[error("scan was cancelled")]
    Cancelled,
    #[error("no folders selected")]
    NoRoots,
    #[error("failed to start worker threads: {0}")]
    ThreadPool(#[from] rayon::ThreadPoolBuildError),
}

/// Runs a full scan. Blocks the calling thread; call it from a background thread.
pub fn run_scan(opts: &ScanOptions, ctx: &ScanContext) -> Result<ScanResult, ScanError> {
    let started = Instant::now();
    let roots = filters::dedupe_roots(&opts.roots);
    if roots.is_empty() {
        return Err(ScanError::NoRoots);
    }

    // Deep directory trees recurse; give workers a generous stack.
    let pool = rayon::ThreadPoolBuilder::new()
        .stack_size(16 * 1024 * 1024)
        .thread_name(|i| format!("scan-{i}"))
        .build()?;

    pool.install(|| {
        ctx.progress.set_phase(Phase::Walking);
        let walk = walker::walk(&roots, opts, ctx);
        ctx.check()?;

        let mut result = ScanResult {
            caches: walk.caches,
            empty_dirs: walk.empty_dirs,
            ..Default::default()
        };

        if opts.find_unused {
            result.unused = unused::find_unused(
                &walk.files,
                opts.unused_months,
                opts.min_unused_size,
                now_unix(),
            );
        }
        if opts.find_duplicates {
            result.duplicates =
                duplicates::find_duplicates(&walk.files, opts.duplicates_photos_only, ctx)?;
        }
        if opts.find_similar {
            result.similar = similar::find_similar(
                &walk.files,
                opts.similarity_distance,
                opts.hash_cache_path.as_deref(),
                ctx,
            )?;
        }

        ctx.progress.set_phase(Phase::Done);
        result.stats = ScanStats {
            files: walk.files_total,
            dirs: ctx.progress.dirs_seen(),
            bytes: walk.bytes_total,
            cloud_only_skipped: walk.files.iter().filter(|f| f.cloud_only).count() as u64,
            errors: ctx.progress.errors(),
            duration_ms: started.elapsed().as_millis() as u64,
        };
        Ok(result)
    })
}

pub(crate) fn unix_secs(t: std::io::Result<SystemTime>) -> i64 {
    match t {
        Ok(t) => match t.duration_since(UNIX_EPOCH) {
            Ok(d) => d.as_secs() as i64,
            Err(e) => -(e.duration().as_secs() as i64),
        },
        Err(_) => 0,
    }
}

pub(crate) fn now_unix() -> i64 {
    unix_secs(Ok(SystemTime::now()))
}

pub(crate) fn has_extension(path: &std::path::Path, exts: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| exts.iter().any(|x| x.eq_ignore_ascii_case(e)))
}
