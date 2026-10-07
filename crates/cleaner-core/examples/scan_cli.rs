//! Headless scan for testing and benchmarking:
//! `cargo run --release -p cleaner-core --example scan_cli -- <folder>...`

use std::path::PathBuf;
use std::time::Duration;

use cleaner_core::{run_scan, ScanContext, ScanOptions};

fn main() {
    let roots: Vec<PathBuf> = std::env::args().skip(1).map(PathBuf::from).collect();
    if roots.is_empty() {
        eprintln!("usage: scan_cli <folder>...");
        std::process::exit(2);
    }
    let opts = ScanOptions {
        roots,
        hash_cache_path: Some(std::env::temp_dir().join("cleaner-core-hashes.bin")),
        ..Default::default()
    };
    let ctx = ScanContext::new();
    let ticker = {
        let progress = ctx.progress.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(500));
            let s = progress.snapshot();
            eprintln!(
                "{:?}: {} files, {} dirs, {}/{} items, {} MB hashed",
                s.phase, s.files_seen, s.dirs_seen, s.items_done, s.items_total, s.bytes_hashed >> 20
            );
            if s.phase == cleaner_core::Phase::Done {
                break;
            }
        })
    };
    let result = run_scan(&opts, &ctx).expect("scan failed");
    let _ = ticker.join();

    let mb = |b: u64| b as f64 / 1_048_576.0;
    println!("{:#?}", result.stats);
    let wasted: u64 = result.duplicates.iter().map(|g| g.size * (g.files.len() as u64 - 1)).sum();
    println!("duplicate groups: {} ({:.1} MB reclaimable)", result.duplicates.len(), mb(wasted));
    for g in result.duplicates.iter().take(5) {
        println!("  {:.1} MB x{}: {}", mb(g.size), g.files.len(), g.files[0].path);
    }
    println!("similar image groups: {}", result.similar.len());
    for g in result.similar.iter().take(5) {
        println!("  {} images, e.g. {}", g.images.len(), g.images[0].file.path);
    }
    println!("cache folders: {}", result.caches.len());
    for c in result.caches.iter().take(10) {
        println!("  {:>9.1} MB  {:<24} {}", mb(c.size), c.kind, c.path);
    }
    println!("unused files: {}", result.unused.len());
    println!("empty folders: {}", result.empty_dirs.len());
    println!(
        "last-access tracking: {:?}",
        cleaner_core::platform::last_access_tracking_enabled()
    );
}
