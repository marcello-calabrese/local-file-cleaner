//! Visually similar images via 64-bit perceptual hashes.
//!
//! Each image is decoded once and reduced to a gradient hash; images whose
//! hashes differ in at most `max_distance` bits are grouped. Hashes are kept
//! in an on-disk cache keyed by path + size + mtime, so rescans only decode
//! new or changed images.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use image_hasher::{HashAlg, HasherConfig};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::{
    has_extension, FileEntry, FileItem, Phase, ScanContext, ScanError, SimilarGroup,
    SimilarImage, DECODABLE_EXTENSIONS,
};

/// Larger files are skipped: decoding them costs a lot of memory and time.
const MAX_IMAGE_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct ImageInfo {
    size: u64,
    modified: i64,
    hash: u64,
    width: u32,
    height: u32,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct HashCache {
    entries: HashMap<PathBuf, ImageInfo>,
}

impl HashCache {
    fn load(path: Option<&Path>) -> Self {
        path.and_then(|p| std::fs::read(p).ok())
            .and_then(|bytes| postcard::from_bytes(&bytes).ok())
            .unwrap_or_default()
    }

    fn save(&self, path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(bytes) = postcard::to_allocvec(self) {
            let tmp = path.with_extension("tmp");
            if std::fs::write(&tmp, bytes).is_ok() {
                let _ = std::fs::rename(&tmp, path);
            }
        }
    }
}

pub fn find_similar(
    files: &[FileEntry],
    max_distance: u32,
    cache_path: Option<&Path>,
    ctx: &ScanContext,
) -> Result<Vec<SimilarGroup>, ScanError> {
    let images: Vec<&FileEntry> = files
        .iter()
        .filter(|f| {
            !f.cloud_only
                && f.size > 0
                && f.size <= MAX_IMAGE_BYTES
                && has_extension(&f.path, DECODABLE_EXTENSIONS)
        })
        .collect();

    let cache = HashCache::load(cache_path);
    ctx.progress.begin_step(Phase::ImageHash, images.len() as u64);
    let hasher = HasherConfig::new().hash_alg(HashAlg::Gradient).hash_size(8, 8).to_hasher();

    let infos: Vec<Option<ImageInfo>> = images
        .par_iter()
        .map(|f| {
            if ctx.is_cancelled() {
                return None;
            }
            let cached = cache
                .entries
                .get(&f.path)
                .filter(|c| c.size == f.size && c.modified == f.modified)
                .copied();
            let info = cached.or_else(|| {
                let info = hash_image(&f.path, &hasher).map(|(hash, width, height)| ImageInfo {
                    size: f.size,
                    modified: f.modified,
                    hash,
                    width,
                    height,
                });
                if info.is_none() {
                    ctx.progress.add_error();
                }
                info
            });
            ctx.progress.item_done();
            info
        })
        .collect();

    // Keep what we have even when cancelled, so the next scan is faster.
    if let Some(path) = cache_path {
        let mut fresh = HashCache::default();
        for (f, info) in images.iter().zip(&infos) {
            if let Some(info) = info {
                fresh.entries.insert(f.path.clone(), *info);
            }
        }
        // Retain cache entries for images outside this scan's roots.
        let scanned: HashSet<&Path> = images.iter().map(|f| f.path.as_path()).collect();
        for (p, info) in cache.entries {
            if !scanned.contains(p.as_path()) && p.exists() {
                fresh.entries.insert(p, info);
            }
        }
        fresh.save(path);
    }
    ctx.check()?;

    let hashed: Vec<(&FileEntry, ImageInfo)> = images
        .into_iter()
        .zip(infos)
        .filter_map(|(f, i)| i.map(|i| (f, i)))
        .collect();
    Ok(group_similar(&hashed, max_distance))
}

fn hash_image(path: &Path, hasher: &image_hasher::Hasher) -> Option<(u64, u32, u32)> {
    let img = image::ImageReader::open(path).ok()?.with_guessed_format().ok()?.decode().ok()?;
    let hash = hasher.hash_image(&img);
    let bytes: [u8; 8] = hash.as_bytes().try_into().ok()?;
    Some((u64::from_le_bytes(bytes), img.width(), img.height()))
}

/// Greedy clustering: take the next unassigned hash as a reference and
/// gather every unassigned hash within `max_distance` of it. Unlike
/// union-find this never chains A~B~C into a group where A and C differ a lot.
fn group_similar(images: &[(&FileEntry, ImageInfo)], max_distance: u32) -> Vec<SimilarGroup> {
    let mut by_hash: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, (_, info)) in images.iter().enumerate() {
        by_hash.entry(info.hash).or_default().push(i);
    }
    let mut tree = BkTree::default();
    for &h in by_hash.keys() {
        tree.insert(h);
    }

    // Most common hashes first so exact copies anchor their groups;
    // ties broken by value for deterministic output.
    let mut order: Vec<(u64, usize)> = by_hash.iter().map(|(h, v)| (*h, v.len())).collect();
    order.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    let mut assigned: HashSet<u64> = HashSet::new();
    let mut groups = Vec::new();
    for (pivot, _) in order {
        if assigned.contains(&pivot) {
            continue;
        }
        let mut members: Vec<(u64, u32)> = tree
            .find(pivot, max_distance)
            .into_iter()
            .filter(|(h, _)| !assigned.contains(h))
            .collect();
        let count: usize = members.iter().map(|(h, _)| by_hash[h].len()).sum();
        if count < 2 {
            continue;
        }
        members.sort_by_key(|(h, d)| (*d, *h));
        let mut group_images = Vec::with_capacity(count);
        for (h, distance) in members {
            assigned.insert(h);
            for &i in &by_hash[&h] {
                let (file, info) = &images[i];
                group_images.push(SimilarImage {
                    file: FileItem::from(*file),
                    width: info.width,
                    height: info.height,
                    distance,
                });
            }
        }
        groups.push(SimilarGroup { images: group_images });
    }
    groups.sort_by_key(|g| std::cmp::Reverse(g.images.iter().map(|i| i.file.size).sum::<u64>()));
    groups
}

/// Burkhard-Keller tree over Hamming distance.
#[derive(Default)]
struct BkTree {
    nodes: Vec<(u64, Vec<(u32, usize)>)>,
}

impl BkTree {
    fn insert(&mut self, value: u64) {
        if self.nodes.is_empty() {
            self.nodes.push((value, Vec::new()));
            return;
        }
        let mut at = 0;
        loop {
            let d = (self.nodes[at].0 ^ value).count_ones();
            if d == 0 {
                return;
            }
            match self.nodes[at].1.iter().find(|(cd, _)| *cd == d) {
                Some(&(_, child)) => at = child,
                None => {
                    let idx = self.nodes.len();
                    self.nodes.push((value, Vec::new()));
                    self.nodes[at].1.push((d, idx));
                    return;
                }
            }
        }
    }

    /// All values within `max` bits of `value`, with their distance.
    fn find(&self, value: u64, max: u32) -> Vec<(u64, u32)> {
        let mut out = Vec::new();
        if self.nodes.is_empty() {
            return out;
        }
        let mut stack = vec![0usize];
        while let Some(at) = stack.pop() {
            let (v, children) = &self.nodes[at];
            let d = (v ^ value).count_ones();
            if d <= max {
                out.push((*v, d));
            }
            for &(cd, child) in children {
                if cd + max >= d && cd <= d + max {
                    stack.push(child);
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    fn gradient_image(w: u32, h: u32, seed: u32) -> image::RgbImage {
        ImageBuffer::from_fn(w, h, |x, y| {
            let v = ((x * 255 / w) ^ (y * seed * 255 / h / 7)) as u8;
            Rgb([v, v.wrapping_add((y % 255) as u8), 255 - v])
        })
    }

    fn entry(path: PathBuf) -> FileEntry {
        let size = std::fs::metadata(&path).unwrap().len();
        FileEntry { path, size, modified: 1, accessed: 1, cloud_only: false }
    }

    #[test]
    fn bk_tree_finds_neighbours() {
        let mut t = BkTree::default();
        for v in [0u64, 1, 3, 0xff, u64::MAX] {
            t.insert(v);
        }
        let mut found: Vec<u64> = t.find(0, 2).into_iter().map(|(v, _)| v).collect();
        found.sort();
        assert_eq!(found, vec![0, 1, 3]);
    }

    #[test]
    fn groups_resized_and_reencoded_copies() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        let original = gradient_image(640, 480, 3);
        original.save(d.join("original.png")).unwrap();
        image::imageops::resize(&original, 320, 240, image::imageops::FilterType::Triangle)
            .save(d.join("small.jpg"))
            .unwrap();
        // A clearly different picture.
        ImageBuffer::from_fn(640, 480, |x, y| {
            let v: u8 = if (x / 40 + y / 40) % 2 == 0 { 0 } else { 255 };
            Rgb([v, v, v])
        })
        .save(d.join("checkers.png"))
        .unwrap();

        let files: Vec<FileEntry> = ["original.png", "small.jpg", "checkers.png"]
            .iter()
            .map(|n| entry(d.join(n)))
            .collect();
        let cache_path = d.join("cache").join("hashes.bin");
        let ctx = ScanContext::new();
        let groups = find_similar(&files, 6, Some(&cache_path), &ctx).unwrap();
        assert_eq!(groups.len(), 1, "{groups:?}");
        let names: HashSet<String> = groups[0]
            .images
            .iter()
            .map(|i| Path::new(&i.file.path).file_name().unwrap().to_string_lossy().into())
            .collect();
        assert_eq!(names, HashSet::from(["original.png".into(), "small.jpg".into()]));
        assert!(groups[0].images.iter().any(|i| i.width == 640 && i.height == 480));

        // Second run is served from the cache and gives the same answer.
        assert!(cache_path.exists());
        let cache = HashCache::load(Some(&cache_path));
        assert_eq!(cache.entries.len(), 3);
        let again = find_similar(&files, 6, Some(&cache_path), &ctx).unwrap();
        assert_eq!(again.len(), 1);
    }
}
