//! Files nobody has opened or changed for a while.

use rayon::prelude::*;

use crate::{FileEntry, FileItem};

/// Average month length in seconds (365.25 / 12 days).
const MONTH_SECS: i64 = 2_629_800;

/// Files whose last-modified *and* last-accessed times are both older than
/// `months` months, largest first. Cloud-only placeholders are skipped: they
/// use no local disk space.
pub fn find_unused(files: &[FileEntry], months: u32, min_size: u64, now: i64) -> Vec<FileItem> {
    let cutoff = now - i64::from(months) * MONTH_SECS;
    let mut out: Vec<FileItem> = files
        .par_iter()
        .filter(|f| !f.cloud_only && f.size >= min_size && f.modified.max(f.accessed) < cutoff)
        .map(FileItem::from)
        .collect();
    out.par_sort_unstable_by(|a, b| b.size.cmp(&a.size));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn file(name: &str, size: u64, modified: i64, accessed: i64) -> FileEntry {
        FileEntry { path: PathBuf::from(name), size, modified, accessed, cloud_only: false }
    }

    #[test]
    fn needs_both_timestamps_older_than_cutoff() {
        let now = 1_000_000_000;
        let old = now - 4 * MONTH_SECS;
        let recent = now - MONTH_SECS;
        let files = vec![
            file("old", 10, old, old),
            file("read_recently", 10, old, recent),
            file("edited_recently", 10, recent, old),
            file("tiny", 1, old, old),
            FileEntry { cloud_only: true, ..file("cloud", 10, old, old) },
        ];
        let out = find_unused(&files, 3, 5, now);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].path, "old");
    }
}
