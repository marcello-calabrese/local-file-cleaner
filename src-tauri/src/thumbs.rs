//! `thumb://` protocol: on-demand JPEG thumbnails for the photo views.
//! The frontend builds URLs with `convertFileSrc(path, "thumb")`.

use std::path::PathBuf;
use std::sync::OnceLock;

use cleaner_core::DECODABLE_EXTENSIONS;
use percent_encoding::percent_decode_str;
use tauri::http::{Request, Response, StatusCode};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};

const SIZE: u32 = 256;

/// A few threads only: a scrolling grid can request dozens at once and
/// decoding full-size photos is memory hungry.
fn pool() -> &'static rayon::ThreadPool {
    static POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(4)
            .thread_name(|i| format!("thumb-{i}"))
            .build()
            .expect("thumbnail pool")
    })
}

pub fn handle<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let raw = request.uri().path().trim_start_matches('/').to_owned();
    pool().spawn(move || {
        let path = PathBuf::from(percent_decode_str(&raw).decode_utf8_lossy().into_owned());
        let is_image = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| DECODABLE_EXTENSIONS.iter().any(|x| x.eq_ignore_ascii_case(e)));
        let response = if !is_image {
            error(StatusCode::FORBIDDEN)
        } else {
            match cleaner_core::thumbnail::make_thumbnail(&path, SIZE) {
                Ok(jpeg) => Response::builder()
                    .header("Content-Type", "image/jpeg")
                    .header("Cache-Control", "max-age=3600")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(jpeg)
                    .unwrap(),
                Err(_) => error(StatusCode::NOT_FOUND),
            }
        };
        responder.respond(response);
    });
}

fn error(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(status).body(Vec::new()).unwrap()
}
