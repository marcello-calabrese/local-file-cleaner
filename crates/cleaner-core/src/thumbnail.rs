//! Small JPEG previews for the results views.

use std::io::Cursor;
use std::path::Path;

/// Decodes `path` and returns a JPEG no larger than `max` x `max`.
pub fn make_thumbnail(path: &Path, max: u32) -> Result<Vec<u8>, image::ImageError> {
    let img = image::ImageReader::open(path)?.with_guessed_format()?.decode()?;
    let thumb = img.thumbnail(max, max).to_rgb8();
    let mut out = Cursor::new(Vec::new());
    thumb.write_to(&mut out, image::ImageFormat::Jpeg)?;
    Ok(out.into_inner())
}
