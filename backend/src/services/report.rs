//! Human-readable PDF forensic report generation.
//!
//! Turns an agent's raw telemetry `Event`s into a polished PDF (cover, summary,
//! screenshot gallery with embedded images, chronological timeline, and tables)
//! that operatives can actually read — instead of the raw `events.json` dump.
//!
//! Generated in-memory and returned as bytes so the caller can drop it straight
//! into the existing archive zip. Fonts are compiled into the binary via
//! `include_bytes!` so there is no runtime font-path dependency on the server.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use chrono::Utc;
use genpdf::{elements, fonts, style, Alignment, Document, Element, SimplePageDecorator};

use crate::db::models::Event;

const TS_FMT: &str = "%Y-%m-%d %H:%M:%S";
/// Screenshots are downscaled to this max width before embedding to keep the PDF sane.
const SCREENSHOT_MAX_WIDTH: u32 = 1000;
/// Rendered image DPI; with ~1000px width this yields ~6.7in (fits A4 content width).
const SCREENSHOT_DPI: f64 = 150.0;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Build a forensic PDF report for one agent. `events` must be sorted ascending
/// by timestamp. Returns the PDF as bytes.
pub fn generate_pdf_report(
    agent_id: &str,
    host_or_label: &str,
    org_name: &str,
    events: &[Event],
    file_storage_dir: &Path,
    max_screenshots: usize,
) -> anyhow::Result<Vec<u8>> {
    let font_family = load_fonts()?;
    let mut doc = Document::new(font_family);
    doc.set_title("RAV Forensic Report");
    doc.set_font_size(10);

    let mut decorator = SimplePageDecorator::new();
    decorator.set_margins(12);
    doc.set_page_decorator(decorator);

    render_cover(&mut doc, agent_id, host_or_label, org_name, events);
    render_summary(&mut doc, events);
    render_screenshots(&mut doc, events, file_storage_dir, max_screenshots);
    render_browser_table(&mut doc, events);
    render_usb_table(&mut doc, events);
    render_network_table(&mut doc, events);
    render_timeline(&mut doc, events);

    let mut buf = Vec::new();
    doc.render(&mut buf)
        .map_err(|e| anyhow::anyhow!("PDF render failed: {}", e))?;
    Ok(buf)
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

fn render_cover(doc: &mut Document, agent_id: &str, host: &str, org: &str, events: &[Event]) {
    doc.push(
        elements::Paragraph::new("RAV FORENSIC TELEMETRY REPORT")
            .aligned(Alignment::Center)
            .styled(style::Style::new().bold().with_font_size(20)),
    );
    doc.push(elements::Break::new(1.0));

    let host_label = if host.is_empty() { agent_id } else { host };
    doc.push(kv("Endpoint", host_label));
    doc.push(kv("Agent ID", agent_id));
    if !org.is_empty() {
        doc.push(kv("Organization", org));
    }

    if let (Some(first), Some(last)) = (events.first(), events.last()) {
        let range = format!(
            "{} — {} (UTC)",
            first.timestamp.format(TS_FMT),
            last.timestamp.format(TS_FMT)
        );
        doc.push(kv("Coverage window", &range));
    }
    doc.push(kv("Total events", &events.len().to_string()));
    doc.push(kv("Generated", &Utc::now().format(TS_FMT).to_string()));

    doc.push(elements::Break::new(1.0));
    doc.push(
        elements::Paragraph::new(
            "CONFIDENTIAL — Burn after reading. This archive is deleted from the vault \
             immediately after a single download, and the source telemetry has been purged \
             from the live system.",
        )
        .styled(style::Style::new().italic().with_font_size(8)),
    );
    doc.push(elements::Break::new(1.0));
}

fn render_summary(doc: &mut Document, events: &[Event]) {
    use std::collections::BTreeMap;

    let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
    let mut blind_spots = 0usize;
    let mut failed_uploads = 0usize;
    for ev in events {
        *counts.entry(bucket(ev)).or_insert(0) += 1;
        let t = ev.event_type.to_lowercase();
        if t.contains("offline") {
            blind_spots += 1;
        }
        if t == "screenshot_upload_failed" {
            failed_uploads += 1;
        }
    }

    doc.push(heading("Executive summary", 14));
    doc.push(elements::Break::new(0.5));

    let mut table = elements::TableLayout::new(vec![6, 2]);
    table.set_cell_decorator(elements::FrameCellDecorator::new(true, true, false));
    let _ = table
        .row()
        .element(cell_bold("Category"))
        .element(cell_bold("Count"))
        .push();
    for (cat, n) in &counts {
        let _ = table
            .row()
            .element(cell(*cat))
            .element(cell(n.to_string()))
            .push();
    }
    doc.push(table);

    if blind_spots > 0 || failed_uploads > 0 {
        doc.push(elements::Break::new(0.5));
        if blind_spots > 0 {
            doc.push(
                elements::Paragraph::new(format!(
                    "⚠ {} telemetry blind spot(s) detected (agent offline periods).",
                    blind_spots
                ))
                .styled(style::Style::new().bold()),
            );
        }
        if failed_uploads > 0 {
            doc.push(
                elements::Paragraph::new(format!(
                    "⚠ {} screenshot upload failure(s) — image(s) may be unavailable.",
                    failed_uploads
                ))
                .styled(style::Style::new().bold()),
            );
        }
    }
    doc.push(elements::Break::new(1.0));
}

fn render_screenshots(doc: &mut Document, events: &[Event], dir: &Path, max: usize) {
    let shots: Vec<&Event> = events
        .iter()
        .filter(|e| e.event_type.eq_ignore_ascii_case("screenshot_captured"))
        .collect();
    if shots.is_empty() {
        return;
    }

    doc.push(heading(&format!("Screenshots ({})", shots.len()), 14));
    doc.push(elements::Break::new(0.5));

    let mut embedded = 0usize;
    for ev in &shots {
        if embedded >= max {
            doc.push(
                elements::Paragraph::new(format!(
                    "(+{} more screenshots omitted from this report to limit size; \
                     all events remain in events.json)",
                    shots.len() - embedded
                ))
                .styled(small()),
            );
            break;
        }

        let ts = ev.timestamp.format(TS_FMT).to_string();
        let dims = match (meta_str(ev, "width"), meta_str(ev, "height")) {
            (Some(w), Some(h)) => format!("{}x{}", w, h),
            _ => "unknown size".to_string(),
        };
        let fmt = meta_str(ev, "format").unwrap_or_else(|| "img".to_string());
        let caption = format!("{}  ·  {}  ·  {}", ts, dims, fmt.to_uppercase());

        let file_id = match meta_str(ev, "file_id") {
            Some(id) => id,
            None => continue,
        };

        doc.push(elements::Paragraph::new(caption).styled(small()));

        match find_file_by_id(dir, &file_id) {
            Some(path) => match screenshot_to_jpeg(&path, SCREENSHOT_MAX_WIDTH) {
                Ok(jpeg) => match elements::Image::from_reader(Cursor::new(jpeg)) {
                    Ok(img) => {
                        doc.push(img.with_alignment(Alignment::Center).with_dpi(SCREENSHOT_DPI));
                    }
                    Err(e) => doc.push(unavailable(&file_id, &e.to_string())),
                },
                Err(e) => doc.push(unavailable(&file_id, &e.to_string())),
            },
            None => doc.push(unavailable(&file_id, "not found on disk")),
        }
        doc.push(elements::Break::new(1.0));
        embedded += 1;
    }
    doc.push(elements::Break::new(1.0));
}

fn render_browser_table(doc: &mut Document, events: &[Event]) {
    let rows: Vec<&Event> = events.iter().filter(|e| bucket(e) == "Browser").collect();
    if rows.is_empty() {
        return;
    }

    doc.push(heading(&format!("Browser activity ({})", rows.len()), 14));
    doc.push(elements::Break::new(0.5));

    let mut table = elements::TableLayout::new(vec![4, 3, 9]);
    table.set_cell_decorator(elements::FrameCellDecorator::new(true, true, false));
    let _ = table
        .row()
        .element(cell_bold("Time"))
        .element(cell_bold("Kind"))
        .element(cell_bold("Detail"))
        .push();

    for ev in rows {
        let t = ev.event_type.to_lowercase();
        let (kind, detail) = if t.contains("search") {
            (
                "search",
                format!(
                    "{}: {}",
                    meta_str(ev, "search_engine").unwrap_or_else(|| "web".into()),
                    meta_str(ev, "query").unwrap_or_default()
                ),
            )
        } else if t.contains("download") {
            (
                "download",
                format!(
                    "{} ← {}",
                    meta_str(ev, "filename")
                        .or_else(|| meta_str(ev, "file_name"))
                        .unwrap_or_default(),
                    meta_str(ev, "source_url").unwrap_or_default()
                ),
            )
        } else {
            (
                "visit",
                format!(
                    "{}  {}",
                    meta_str(ev, "url").unwrap_or_default(),
                    meta_str(ev, "title")
                        .map(|s| format!("— {}", s))
                        .unwrap_or_default()
                ),
            )
        };
        let _ = table
            .row()
            .element(cell(ev.timestamp.format(TS_FMT).to_string()))
            .element(cell(kind))
            .element(cell(truncate(detail.trim(), 90)))
            .push();
    }
    doc.push(table);
    doc.push(elements::Break::new(1.0));
}

fn render_usb_table(doc: &mut Document, events: &[Event]) {
    let rows: Vec<&Event> = events.iter().filter(|e| bucket(e) == "USB").collect();
    if rows.is_empty() {
        return;
    }

    doc.push(heading(&format!("USB activity ({})", rows.len()), 14));
    doc.push(elements::Break::new(0.5));

    let mut table = elements::TableLayout::new(vec![4, 3, 9]);
    table.set_cell_decorator(elements::FrameCellDecorator::new(true, true, false));
    let _ = table
        .row()
        .element(cell_bold("Time"))
        .element(cell_bold("Event"))
        .element(cell_bold("Device / File"))
        .push();

    for ev in rows {
        let t = ev.event_type.to_lowercase();
        let device = meta_str(ev, "device_name").unwrap_or_else(|| "unknown device".into());
        let (kind, detail) = if t.contains("file_transfer") {
            (
                "transfer",
                format!(
                    "{} [{}] {} ({})",
                    meta_str(ev, "file_name").unwrap_or_default(),
                    meta_str(ev, "direction").unwrap_or_default(),
                    device,
                    meta_str(ev, "file_size").unwrap_or_default()
                ),
            )
        } else if t.contains("removed") {
            ("removed", device)
        } else {
            ("inserted", device)
        };
        let _ = table
            .row()
            .element(cell(ev.timestamp.format(TS_FMT).to_string()))
            .element(cell(kind))
            .element(cell(truncate(detail.trim(), 90)))
            .push();
    }
    doc.push(table);
    doc.push(elements::Break::new(1.0));
}

fn render_network_table(doc: &mut Document, events: &[Event]) {
    let rows: Vec<&Event> = events.iter().filter(|e| bucket(e) == "Network").collect();
    if rows.is_empty() {
        return;
    }

    doc.push(heading(&format!("Network connections ({})", rows.len()), 14));
    doc.push(elements::Break::new(0.5));

    let mut table = elements::TableLayout::new(vec![4, 6, 6]);
    table.set_cell_decorator(elements::FrameCellDecorator::new(true, true, false));
    let _ = table
        .row()
        .element(cell_bold("Time"))
        .element(cell_bold("Destination"))
        .element(cell_bold("Process"))
        .push();

    for ev in rows {
        let dest = format!(
            "{}:{}",
            meta_str(ev, "remote_ip").unwrap_or_default(),
            meta_str(ev, "remote_port").unwrap_or_default()
        );
        let _ = table
            .row()
            .element(cell(ev.timestamp.format(TS_FMT).to_string()))
            .element(cell(truncate(dest.trim_end_matches(':'), 40)))
            .element(cell(truncate(
                &meta_str(ev, "process_name").unwrap_or_default(),
                40,
            )))
            .push();
    }
    doc.push(table);
    doc.push(elements::Break::new(1.0));
}

fn render_timeline(doc: &mut Document, events: &[Event]) {
    doc.push(heading("Full chronological timeline", 14));
    doc.push(elements::Break::new(0.5));
    for ev in events {
        let line = format!("[{}]  {}", ev.timestamp.format(TS_FMT), describe_event(ev));
        doc.push(elements::Paragraph::new(line).styled(style::Style::new().with_font_size(9)));
    }
}

// ---------------------------------------------------------------------------
// Event -> human-readable description (mirrors dashboard TelemetryExplorer)
// ---------------------------------------------------------------------------

/// One-line plain-English description of an event for the timeline.
pub fn describe_event(ev: &Event) -> String {
    let t = ev.event_type.to_lowercase();
    let m = |k: &str| meta_str(ev, k).unwrap_or_default();

    if t == "screenshot_captured" {
        format!(
            "Screenshot captured ({}x{}, {})",
            m("width"),
            m("height"),
            m("format")
        )
    } else if t == "screenshot_upload_failed" {
        format!("Screenshot upload FAILED: {}", m("upload_error"))
    } else if t.contains("search") {
        format!(
            "Search ({}): {}",
            meta_str(ev, "search_engine").unwrap_or_else(|| "web".into()),
            m("query")
        )
    } else if t.contains("download") {
        format!(
            "Download: {} from {}",
            meta_str(ev, "filename")
                .or_else(|| meta_str(ev, "file_name"))
                .unwrap_or_default(),
            m("source_url")
        )
    } else if t.contains("history") || t.contains("active_tab") || t.contains("tab_updated") {
        let incog = if meta_str(ev, "incognito").as_deref() == Some("true") {
            " (incognito)"
        } else {
            ""
        };
        format!("Visited {} — {}{}", m("url"), m("title"), incog)
    } else if t == "usb_inserted" {
        format!("USB inserted: {} [{}]", m("device_name"), m("device_id"))
    } else if t == "usb_removed" {
        format!("USB removed: {} [{}]", m("device_name"), m("device_id"))
    } else if t.contains("file_transfer") {
        format!(
            "USB file {}: {} ({}) ↔ {}",
            m("direction"),
            m("file_name"),
            m("file_size"),
            m("device_name")
        )
    } else if t.contains("network") || t.contains("connection") {
        format!(
            "Network {}: {} → {}:{} ({})",
            meta_str(ev, "status").unwrap_or_default(),
            m("process_name"),
            m("remote_ip"),
            m("remote_port"),
            m("protocol")
        )
    } else if t.contains("wifi") {
        format!(
            "Wi-Fi changed: {} → {} (signal {})",
            m("previous_ssid"),
            m("current_ssid"),
            m("signal")
        )
    } else if t == "process_started" {
        format!(
            "Process started: {} (pid {}) {}",
            m("process_name"),
            m("pid"),
            m("executable_path")
        )
    } else if t == "process_stopped" {
        format!("Process stopped: {} (pid {})", m("process_name"), m("pid"))
    } else if t.contains("offline") {
        format!(
            "BLIND SPOT: agent offline {} → {} ({}s)",
            m("offline_from"),
            m("offline_to"),
            m("duration_seconds")
        )
    } else if t.contains("audit") {
        m("message")
    } else {
        ev.event_type.replace('_', " ").to_lowercase()
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn load_fonts() -> anyhow::Result<fonts::FontFamily<fonts::FontData>> {
    let regular = fonts::FontData::new(
        include_bytes!("../../assets/fonts/DejaVuSans.ttf").to_vec(),
        None,
    )?;
    let bold = fonts::FontData::new(
        include_bytes!("../../assets/fonts/DejaVuSans-Bold.ttf").to_vec(),
        None,
    )?;
    let italic = fonts::FontData::new(
        include_bytes!("../../assets/fonts/DejaVuSans-Oblique.ttf").to_vec(),
        None,
    )?;
    let bold_italic = fonts::FontData::new(
        include_bytes!("../../assets/fonts/DejaVuSans-BoldOblique.ttf").to_vec(),
        None,
    )?;
    Ok(fonts::FontFamily {
        regular,
        bold,
        italic,
        bold_italic,
    })
}

/// Locate `{file_id}.{ext}` on disk by scanning the storage dir (matches download_file).
fn find_file_by_id(dir: &Path, file_id: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_stem().and_then(|s| s.to_str()) == Some(file_id) {
            return Some(path);
        }
    }
    None
}

/// Decode, downscale to `max_w`, and re-encode as JPEG to bound PDF size/memory.
fn screenshot_to_jpeg(path: &Path, max_w: u32) -> anyhow::Result<Vec<u8>> {
    let img = image::open(path)?;
    let img = if img.width() > max_w {
        img.resize(max_w, u32::MAX, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    // JPEG has no alpha channel — flatten to RGB.
    let rgb = image::DynamicImage::ImageRgb8(img.to_rgb8());
    let mut cur = Cursor::new(Vec::new());
    rgb.write_to(&mut cur, image::ImageOutputFormat::Jpeg(72))?;
    Ok(cur.into_inner())
}

fn meta_str(ev: &Event, key: &str) -> Option<String> {
    ev.metadata.get(key).and_then(|v| match v {
        serde_json::Value::String(s) => {
            if s.is_empty() {
                None
            } else {
                Some(s.clone())
            }
        }
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    })
}

fn bucket(ev: &Event) -> &'static str {
    let t = ev.event_type.to_lowercase();
    if t.contains("screenshot") {
        "Screenshots"
    } else if t.contains("usb") {
        "USB"
    } else if t.contains("browser")
        || t.contains("history")
        || t.contains("active_tab")
        || t.contains("tab_updated")
        || t.contains("search")
        || t.contains("download")
    {
        "Browser"
    } else if t.contains("network") || t.contains("connection") {
        "Network"
    } else if t.contains("wifi") {
        "Wi-Fi"
    } else if t.contains("process") {
        "Processes"
    } else if t.contains("offline") {
        "Offline gaps"
    } else if t.contains("audit") {
        "Audit"
    } else {
        "Other"
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() > max {
        let kept: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{}…", kept)
    } else {
        s.to_string()
    }
}

fn small() -> style::Style {
    style::Style::new().with_font_size(8)
}

fn heading(text: &str, size: u8) -> impl Element {
    elements::Paragraph::new(text).styled(style::Style::new().bold().with_font_size(size))
}

fn kv(key: &str, value: &str) -> impl Element {
    elements::Paragraph::new(format!("{}: {}", key, value))
}

fn cell(text: impl Into<String>) -> impl Element {
    elements::Paragraph::new(text.into()).padded(1)
}

fn cell_bold(text: impl Into<String>) -> impl Element {
    elements::Paragraph::new(text.into())
        .styled(style::Style::new().bold())
        .padded(1)
}

fn unavailable(file_id: &str, reason: &str) -> impl Element {
    elements::Paragraph::new(format!("[screenshot {} unavailable: {}]", file_id, reason)).styled(small())
}
