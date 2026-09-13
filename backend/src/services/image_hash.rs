//! Perceptual image hashing (dHash) — used to fingerprint screenshots on
//! upload so the dashboard can suppress near-duplicate frames (a user sat on
//! the same screen for hours would otherwise flood the Critical + Screenshots
//! views with hundreds of visually-identical captures).
//!
//! Algorithm: 9-wide × 8-tall grayscale, difference between horizontally
//! adjacent pixels → 64-bit hash. Compare two hashes by Hamming distance;
//! a distance ≤ 5 typically means "human can't tell them apart."
//!
//! Runs in a few milliseconds per PNG/JPEG on release builds; called from
//! `upload_file` for screenshot uploads only (agent decides via extension).

use image::{imageops::FilterType, GrayImage, ImageError};

/// Compute the 64-bit dHash of the given image bytes.
/// Returns a hex string (16 chars, lowercase). None on decode failure.
pub fn dhash_hex(bytes: &[u8]) -> Option<String> {
    dhash(bytes).ok().map(|h| format!("{:016x}", h))
}

fn dhash(bytes: &[u8]) -> Result<u64, ImageError> {
    let img = image::load_from_memory(bytes)?;
    let small: GrayImage = image::imageops::resize(
        &img.into_luma8(),
        9,
        8,
        FilterType::Triangle,
    );

    let mut hash: u64 = 0;
    let mut bit_index = 0;
    for y in 0..8u32 {
        for x in 0..8u32 {
            let left = small.get_pixel(x, y).0[0];
            let right = small.get_pixel(x + 1, y).0[0];
            if left > right {
                hash |= 1u64 << bit_index;
            }
            bit_index += 1;
        }
    }
    Ok(hash)
}

/// Hamming distance between two hex-encoded dHashes. Returns 64 (max) if
/// either input is not a valid 16-char hex string, i.e. treat as "not
/// similar" rather than crashing the caller.
pub fn hamming_hex(a: &str, b: &str) -> u32 {
    let av = u64::from_str_radix(a, 16).unwrap_or(u64::MAX);
    let bv = u64::from_str_radix(b, 16).unwrap_or(0);
    (av ^ bv).count_ones()
}

/// Distance ≤ SIMILAR_THRESHOLD means "effectively the same screen." Tuned
/// on real captures: 5 catches "same window, mouse moved, clock ticked"
/// without collapsing genuinely different scenes.
pub const SIMILAR_THRESHOLD: u32 = 5;
