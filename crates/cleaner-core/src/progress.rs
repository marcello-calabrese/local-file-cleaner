use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering::Relaxed};
use std::sync::Arc;

use serde::Serialize;

use crate::ScanError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[repr(u8)]
pub enum Phase {
    Starting,
    Walking,
    QuickHash,
    FullHash,
    ImageHash,
    Done,
}

impl Phase {
    fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Walking,
            2 => Self::QuickHash,
            3 => Self::FullHash,
            4 => Self::ImageHash,
            5 => Self::Done,
            _ => Self::Starting,
        }
    }
}

/// Lock-free counters updated by worker threads and polled by the UI.
#[derive(Debug, Default)]
pub struct Progress {
    phase: AtomicU8,
    files_seen: AtomicU64,
    dirs_seen: AtomicU64,
    bytes_seen: AtomicU64,
    bytes_hashed: AtomicU64,
    items_done: AtomicU64,
    items_total: AtomicU64,
    errors: AtomicU64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSnapshot {
    pub phase: Phase,
    pub files_seen: u64,
    pub dirs_seen: u64,
    pub bytes_seen: u64,
    pub bytes_hashed: u64,
    pub items_done: u64,
    pub items_total: u64,
    pub errors: u64,
}

impl Progress {
    pub fn snapshot(&self) -> ProgressSnapshot {
        ProgressSnapshot {
            phase: Phase::from_u8(self.phase.load(Relaxed)),
            files_seen: self.files_seen.load(Relaxed),
            dirs_seen: self.dirs_seen.load(Relaxed),
            bytes_seen: self.bytes_seen.load(Relaxed),
            bytes_hashed: self.bytes_hashed.load(Relaxed),
            items_done: self.items_done.load(Relaxed),
            items_total: self.items_total.load(Relaxed),
            errors: self.errors.load(Relaxed),
        }
    }

    pub(crate) fn set_phase(&self, phase: Phase) {
        self.phase.store(phase as u8, Relaxed);
    }

    /// Starts a countable step (e.g. "hash 1200 files").
    pub(crate) fn begin_step(&self, phase: Phase, total: u64) {
        self.items_done.store(0, Relaxed);
        self.items_total.store(total, Relaxed);
        self.set_phase(phase);
    }

    pub(crate) fn item_done(&self) {
        self.items_done.fetch_add(1, Relaxed);
    }

    pub(crate) fn add_files(&self, count: u64, bytes: u64) {
        self.files_seen.fetch_add(count, Relaxed);
        self.bytes_seen.fetch_add(bytes, Relaxed);
    }

    pub(crate) fn add_dir(&self) {
        self.dirs_seen.fetch_add(1, Relaxed);
    }

    pub(crate) fn add_hashed(&self, bytes: u64) {
        self.bytes_hashed.fetch_add(bytes, Relaxed);
    }

    pub(crate) fn add_error(&self) {
        self.errors.fetch_add(1, Relaxed);
    }

    pub(crate) fn dirs_seen(&self) -> u64 {
        self.dirs_seen.load(Relaxed)
    }

    pub(crate) fn errors(&self) -> u64 {
        self.errors.load(Relaxed)
    }
}

/// Shared state for one scan: progress counters plus a cancel flag.
#[derive(Debug, Clone, Default)]
pub struct ScanContext {
    pub progress: Arc<Progress>,
    cancelled: Arc<AtomicBool>,
}

impl ScanContext {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Relaxed)
    }

    pub(crate) fn check(&self) -> Result<(), ScanError> {
        if self.is_cancelled() {
            Err(ScanError::Cancelled)
        } else {
            Ok(())
        }
    }
}
