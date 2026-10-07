//! Byte-for-byte duplicate detection.
//!
//! 1. Group by size (free, from the walk). Unique sizes can't be duplicates.
//! 2. Quick hash: xxh3 of the first and last 16 KB. Cheap, eliminates most.
//! 3. Full BLAKE3 hash of the remaining candidates.

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use rayon::prelude::*;

use crate::{has_extension, DuplicateGroup, FileEntry, FileItem, Phase, ScanContext, ScanError};
use crate::PHOTO_EXTENSIONS;

const EDGE: u64 = 16 * 1024;
const BUF: usize = 256 * 1024;

pub fn find_duplicates(
    files: &[FileEntry],
    photos_only: bool,
    ctx: &ScanContext,
) -> Result<Vec<DuplicateGroup>, ScanError> {
    let mut by_size: HashMap<u64, Vec<&FileEntry>> = HashMap::new();
    for f in files {
        if f.size > 0 && !f.cloud_only && (!photos_only || has_extension(&f.path, PHOTO_EXTENSIONS))
        {
            by_size.entry(f.size).or_default().push(f);
        }
    }
    let candidates: Vec<&FileEntry> =
        by_size.into_values().filter(|g| g.len() > 1).flatten().collect();

    // Stage 2: quick hash.
    ctx.progress.begin_step(Phase::QuickHash, candidates.len() as u64);
    let quick: Vec<((u64, u64), &FileEntry)> = candidates
        .par_iter()
        .filter_map(|f| {
            if ctx.is_cancelled() {
                return None;
            }
            let h = quick_hash(&f.path, f.size);
            ctx.progress.item_done();
            match h {
                Ok(h) => Some(((f.size, h), *f)),
                Err(_) => {
                    ctx.progress.add_error();
                    None
                }
            }
        })
        .collect();
    ctx.check()?;
    let candidates: Vec<&FileEntry> = group(quick).flat_map(|(_, g)| g).collect();

    // Stage 3: full hash.
    ctx.progress.begin_step(Phase::FullHash, candidates.len() as u64);
    let full: Vec<((u64, [u8; 32]), &FileEntry)> = candidates
        .par_iter()
        .filter_map(|f| {
            let h = full_hash(&f.path, ctx);
            ctx.progress.item_done();
            match h {
                Ok(h) => Some(((f.size, h), *f)),
                Err(_) => {
                    if !ctx.is_cancelled() {
                        ctx.progress.add_error();
                    }
                    None
                }
            }
        })
        .collect();
    ctx.check()?;

    let mut groups: Vec<DuplicateGroup> = group(full)
        .map(|((size, hash), g)| {
            let mut files: Vec<FileItem> = g.into_iter().map(FileItem::from).collect();
            files.sort_by(|a, b| a.path.cmp(&b.path));
            DuplicateGroup { hash: hex(&hash), size, files }
        })
        .collect();
    // Most reclaimable space first.
    groups.sort_by_key(|g| std::cmp::Reverse(g.size * (g.files.len() as u64 - 1)));
    Ok(groups)
}

/// Groups by key, keeping only groups with at least two members.
fn group<K: std::hash::Hash + Eq, V>(items: Vec<(K, V)>) -> impl Iterator<Item = (K, Vec<V>)> {
    let mut map: HashMap<K, Vec<V>> = HashMap::new();
    for (k, v) in items {
        map.entry(k).or_default().push(v);
    }
    map.into_iter().filter(|(_, g)| g.len() > 1)
}

fn quick_hash(path: &Path, size: u64) -> io::Result<u64> {
    let mut file = File::open(path)?;
    let mut hasher = xxhash_rust::xxh3::Xxh3::new();
    let mut buf = vec![0u8; EDGE as usize];
    let n = read_up_to(&mut file, &mut buf)?;
    hasher.update(&buf[..n]);
    if size > 2 * EDGE {
        file.seek(SeekFrom::End(-(EDGE as i64)))?;
        let n = read_up_to(&mut file, &mut buf)?;
        hasher.update(&buf[..n]);
    } else if size > EDGE {
        let n = read_up_to(&mut file, &mut buf)?;
        hasher.update(&buf[..n]);
    }
    Ok(hasher.digest())
}

fn full_hash(path: &Path, ctx: &ScanContext) -> io::Result<[u8; 32]> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; BUF];
    loop {
        if ctx.is_cancelled() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        ctx.progress.add_hashed(n as u64);
    }
    Ok(*hasher.finalize().as_bytes())
}

fn read_up_to(file: &mut File, buf: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match file.read(&mut buf[filled..])? {
            0 => break,
            n => filled += n,
        }
    }
    Ok(filled)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn entry(path: &Path) -> FileEntry {
        FileEntry {
            path: path.to_path_buf(),
            size: fs::metadata(path).unwrap().len(),
            modified: 0,
            accessed: 0,
            cloud_only: false,
        }
    }

    #[test]
    fn finds_only_true_duplicates() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        let big: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
        let mut big_mid = big.clone();
        big_mid[50_000] ^= 0xff; // same size, same edges, different middle

        fs::write(d.join("a.jpg"), &big).unwrap();
        fs::write(d.join("b.jpg"), &big).unwrap();
        fs::write(d.join("c.jpg"), &big_mid).unwrap();
        fs::write(d.join("small1.png"), b"hello").unwrap();
        fs::write(d.join("small2.png"), b"hello").unwrap();
        fs::write(d.join("small3.png"), b"world").unwrap();
        fs::write(d.join("doc1.txt"), b"same").unwrap();
        fs::write(d.join("doc2.txt"), b"same").unwrap();

        let files: Vec<FileEntry> =
            fs::read_dir(d).unwrap().map(|e| entry(&e.unwrap().path())).collect();
        let ctx = ScanContext::new();

        let groups = find_duplicates(&files, true, &ctx).unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].size, 100_000);
        assert!(groups[0].files[0].path.ends_with("a.jpg"));
        assert!(groups[0].files[1].path.ends_with("b.jpg"));
        assert_eq!(groups[1].files.len(), 2);

        let all = find_duplicates(&files, false, &ctx).unwrap();
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn cancel_stops_hashing() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.jpg"), b"x").unwrap();
        fs::write(tmp.path().join("b.jpg"), b"x").unwrap();
        let files = vec![entry(&tmp.path().join("a.jpg")), entry(&tmp.path().join("b.jpg"))];
        let ctx = ScanContext::new();
        ctx.cancel();
        assert!(matches!(find_duplicates(&files, true, &ctx), Err(ScanError::Cancelled)));
    }
}
