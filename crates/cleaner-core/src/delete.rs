//! Moving files to the Recycle Bin. Never deletes permanently.

use std::path::PathBuf;

use serde::Serialize;

const CHUNK: usize = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOutcome {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// Sends each path to the Recycle Bin and reports per-path success.
/// Paths are batched (one shell operation per chunk is much faster); if a
/// batch fails, its paths are retried one by one to find the culprits.
pub fn move_to_recycle_bin(paths: &[PathBuf]) -> Vec<DeleteOutcome> {
    let mut out = Vec::with_capacity(paths.len());
    for chunk in paths.chunks(CHUNK) {
        let existing: Vec<&PathBuf> = chunk.iter().filter(|p| p.exists()).collect();
        let batch_ok = !existing.is_empty() && trash::delete_all(&existing).is_ok();
        for path in chunk {
            let result = if !path.exists() && batch_ok {
                Ok(())
            } else if !path.exists() {
                Err("file no longer exists".to_string())
            } else {
                trash::delete(path).map_err(|e| e.to_string())
            };
            out.push(DeleteOutcome {
                path: path.to_string_lossy().into_owned(),
                ok: result.is_ok(),
                error: result.err(),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_reported_not_panicking() {
        let out = move_to_recycle_bin(&[PathBuf::from(r"Z:\definitely\missing\file.txt")]);
        assert_eq!(out.len(), 1);
        assert!(!out[0].ok);
    }
}
