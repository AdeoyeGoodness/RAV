//! Human-readable HTML forensic reports — one self-contained `.html` file per section.
//!
//! Each file opens in any browser: clickable URLs, embedded screenshots (base64),
//! readable tables, and a chronological timeline. Operatives can Print -> Save as PDF
//! if they need a PDF copy (links stay clickable).
//!
//! SECURITY: these reports render attacker-influenced data (visited URLs, page titles,
//! filenames, etc. captured from monitored endpoints). Every interpolated value is
//! HTML-escaped, and only http(s)/ftp URLs are turned into links (never javascript:).

use std::path::{Path, PathBuf};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use chrono::Utc;

use crate::db::models::Event;

const TS_FMT: &str = "%Y-%m-%d %H:%M:%S";
/// Screenshots are downscaled to this max width before base64-embedding to keep file size sane.
const SCREENSHOT_MAX_WIDTH: u32 = 1000;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Build a set of forensic HTML reports for one agent — one per section — returned as
/// (filename, bytes) pairs to drop into the archive zip. `events` must be sorted
/// ascending by timestamp. The overview is always produced; section files only when
/// that section has content.
pub fn generate_section_reports(
    agent_id: &str,
    host_or_label: &str,
    org_name: &str,
    events: &[Event],
    file_storage_dir: &Path,
    max_screenshots: usize,
) -> anyhow::Result<Vec<(String, Vec<u8>)>> {
    let mut reports: Vec<(String, Vec<u8>)> = Vec::new();

    // Overview: cover + executive summary + full chronological timeline (always).
    {
        let mut body = cover_block(agent_id, host_or_label, org_name, events);
        body.push_str(&summary_block(events));
        body.push_str(&timeline_block(events));
        reports.push((
            "00_overview.html".to_string(),
            wrap_html("Overview", &body).into_bytes(),
        ));
    }

    if events.iter().any(|e| e.event_type.eq_ignore_ascii_case("screenshot_captured")) {
        let mut body = section_header_block(host_or_label, agent_id, events);
        body.push_str(&screenshots_block(events, file_storage_dir, max_screenshots));
        reports.push((
            "screenshots.html".to_string(),
            wrap_html("Screenshots", &body).into_bytes(),
        ));
    }

    if events.iter().any(|e| bucket(e) == "Browser") {
        let mut body = section_header_block(host_or_label, agent_id, events);
        body.push_str(&browser_block(events));
        reports.push((
            "browser_activity.html".to_string(),
            wrap_html("Browser activity", &body).into_bytes(),
        ));
    }

    if events.iter().any(|e| bucket(e) == "USB") {
        let mut body = section_header_block(host_or_label, agent_id, events);
        body.push_str(&usb_block(events));
        reports.push((
            "usb_activity.html".to_string(),
            wrap_html("USB activity", &body).into_bytes(),
        ));
    }

    if events.iter().any(|e| bucket(e) == "Network") {
        let mut body = section_header_block(host_or_label, agent_id, events);
        body.push_str(&network_block(events));
        reports.push((
            "network_connections.html".to_string(),
            wrap_html("Network connections", &body).into_bytes(),
        ));
    }

    Ok(reports)
}

// ---------------------------------------------------------------------------
// Page shell + headers
// ---------------------------------------------------------------------------

fn wrap_html(section_title: &str, body: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RAV Forensic — {title}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; color: #16181f; background: #f4f5f8;
         font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }}
  header.brand {{ background: #0c0e1c; color: #fff; padding: 18px 28px; }}
  header.brand h1 {{ font-size: 18px; margin: 0; letter-spacing: .04em; }}
  header.brand .sub {{ color: #8b93a7; font-size: 12px; margin-top: 4px; text-transform: uppercase; letter-spacing: .12em; }}
  .container {{ max-width: 1040px; margin: 0 auto; padding: 24px 28px 64px; }}
  h2 {{ font-size: 16px; margin: 28px 0 10px; border-bottom: 2px solid #0c0e1c; padding-bottom: 6px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; background: #fff;
          border: 1px solid #e2e5ec; border-radius: 6px; overflow: hidden; }}
  th, td {{ text-align: left; padding: 8px 11px; border-bottom: 1px solid #eceef3; vertical-align: top; }}
  th {{ background: #eef0f5; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #4a5163; }}
  tr:last-child td {{ border-bottom: none; }}
  a {{ color: #1558d6; word-break: break-all; }}
  .kv td:first-child {{ color: #6b7280; width: 180px; font-weight: 600; }}
  .confidential {{ margin-top: 16px; padding: 10px 14px; background: #fff4f4; border: 1px solid #f3c2c2;
                   color: #97211f; font-size: 12px; border-radius: 6px; }}
  .warn {{ color: #b00020; font-weight: 700; }}
  .gallery figure {{ margin: 0 0 22px; }}
  .gallery img {{ max-width: 100%; border: 1px solid #cfd3dc; border-radius: 6px; display: block; }}
  .gallery figcaption {{ font-size: 12px; color: #555; margin-bottom: 6px; font-family: ui-monospace, Menlo, Consolas, monospace; }}
  .timeline {{ background: #fff; border: 1px solid #e2e5ec; border-radius: 6px; padding: 6px 12px; }}
  .timeline div {{ font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;
                   padding: 3px 0; border-bottom: 1px solid #f3f4f7; white-space: pre-wrap; word-break: break-word; }}
  .timeline div:last-child {{ border-bottom: none; }}
  .muted {{ color: #6b7280; font-size: 12px; }}
  @media print {{ body {{ background: #fff; }} a {{ color: #1558d6; }} }}
</style>
</head>
<body>
<header class="brand">
  <h1>RAV FORENSIC REPORT</h1>
  <div class="sub">{title}</div>
</header>
<div class="container">
{body}
</div>
</body>
</html>"#,
        title = html_escape(section_title),
        body = body
    )
}

fn cover_block(agent_id: &str, host: &str, org: &str, events: &[Event]) -> String {
    let host_label = if host.is_empty() { agent_id } else { host };
    let window = window_str(events);
    let mut s = String::new();
    s.push_str("<h2>Case overview</h2>\n<table class=\"kv\">\n");
    s.push_str(&kv_row("Endpoint", host_label));
    s.push_str(&kv_row("Agent ID", agent_id));
    if !org.is_empty() {
        s.push_str(&kv_row("Organization", org));
    }
    s.push_str(&kv_row("Coverage window", &window));
    s.push_str(&kv_row("Total events", &events.len().to_string()));
    s.push_str(&kv_row("Generated", &format!("{} UTC", Utc::now().format(TS_FMT))));
    s.push_str("</table>\n");
    s.push_str(
        "<div class=\"confidential\">CONFIDENTIAL — Burn after reading. This archive is deleted \
         from the vault after a single download, and the source telemetry has been purged from \
         the live system.</div>\n",
    );
    s
}

fn section_header_block(host: &str, agent_id: &str, events: &[Event]) -> String {
    let host_label = if host.is_empty() { agent_id } else { host };
    format!(
        "<p class=\"muted\">{} &middot; {} &middot; {}</p>\n",
        html_escape(host_label),
        html_escape(agent_id),
        html_escape(&window_str(events))
    )
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

fn summary_block(events: &[Event]) -> String {
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

    let mut s = String::from("<h2>Executive summary</h2>\n<table>\n<tr><th>Category</th><th>Count</th></tr>\n");
    for (cat, n) in &counts {
        s.push_str(&format!("<tr><td>{}</td><td>{}</td></tr>\n", html_escape(cat), n));
    }
    s.push_str("</table>\n");

    if blind_spots > 0 {
        s.push_str(&format!(
            "<p class=\"warn\">⚠ {} telemetry blind spot(s) detected (agent offline periods).</p>\n",
            blind_spots
        ));
    }
    if failed_uploads > 0 {
        s.push_str(&format!(
            "<p class=\"warn\">⚠ {} screenshot upload failure(s) — image(s) may be unavailable.</p>\n",
            failed_uploads
        ));
    }
    s
}

fn timeline_block(events: &[Event]) -> String {
    let mut s = String::from("<h2>Chronological timeline</h2>\n<div class=\"timeline\">\n");
    for ev in events {
        s.push_str(&format!(
            "<div>[{}]  {}</div>\n",
            ev.timestamp.format(TS_FMT),
            html_escape(&describe_event(ev))
        ));
    }
    s.push_str("</div>\n");
    s
}

fn screenshots_block(events: &[Event], dir: &Path, max: usize) -> String {
    let shots: Vec<&Event> = events
        .iter()
        .filter(|e| e.event_type.eq_ignore_ascii_case("screenshot_captured"))
        .collect();

    let mut s = format!("<h2>Screenshots ({})</h2>\n<div class=\"gallery\">\n", shots.len());
    let mut embedded = 0usize;
    for ev in &shots {
        if embedded >= max {
            s.push_str(&format!(
                "<p class=\"muted\">(+{} more screenshots omitted to limit file size; all events remain in events.json)</p>\n",
                shots.len() - embedded
            ));
            break;
        }
        let ts = ev.timestamp.format(TS_FMT).to_string();
        let dims = match (meta_str(ev, "width"), meta_str(ev, "height")) {
            (Some(w), Some(h)) => format!("{}x{}", w, h),
            _ => "unknown size".to_string(),
        };
        let fmt = meta_str(ev, "format").unwrap_or_else(|| "img".to_string());
        let caption = html_escape(&format!("{}  ·  {}  ·  {}", ts, dims, fmt.to_uppercase()));

        let file_id = match meta_str(ev, "file_id") {
            Some(id) => id,
            None => continue,
        };

        let img_html = match find_file_by_id(dir, &file_id) {
            Some(path) => match screenshot_to_data_uri(&path, SCREENSHOT_MAX_WIDTH) {
                Ok(uri) => format!("<img src=\"{}\" alt=\"screenshot\">", uri),
                Err(e) => format!(
                    "<p class=\"muted\">[screenshot {} unavailable: {}]</p>",
                    html_escape(&file_id),
                    html_escape(&e.to_string())
                ),
            },
            None => format!(
                "<p class=\"muted\">[screenshot {} not found on disk]</p>",
                html_escape(&file_id)
            ),
        };
        s.push_str(&format!(
            "<figure><figcaption>{}</figcaption>{}</figure>\n",
            caption, img_html
        ));
        embedded += 1;
    }
    s.push_str("</div>\n");
    s
}

fn browser_block(events: &[Event]) -> String {
    let rows: Vec<&Event> = events.iter().filter(|e| bucket(e) == "Browser").collect();
    let mut s = format!(
        "<h2>Browser activity ({})</h2>\n<table>\n<tr><th>Time</th><th>Kind</th><th>Detail</th></tr>\n",
        rows.len()
    );
    for ev in rows {
        let t = ev.event_type.to_lowercase();
        let time = ev.timestamp.format(TS_FMT).to_string();
        let (kind, url, label) = if t.contains("search") {
            (
                "search",
                meta_str(ev, "url"),
                format!(
                    "{}: {}",
                    meta_str(ev, "search_engine").unwrap_or_else(|| "web".into()),
                    meta_str(ev, "query").unwrap_or_default()
                ),
            )
        } else if t.contains("download") {
            (
                "download",
                meta_str(ev, "source_url"),
                format!(
                    "↓ {}",
                    meta_str(ev, "filename")
                        .or_else(|| meta_str(ev, "file_name"))
                        .unwrap_or_default()
                ),
            )
        } else {
            (
                "visit",
                meta_str(ev, "url"),
                meta_str(ev, "title").unwrap_or_default(),
            )
        };

        let detail = render_url_detail(url.as_deref(), label.trim());
        s.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td>{}</td></tr>\n",
            html_escape(&time),
            kind,
            detail
        ));
    }
    s.push_str("</table>\n");
    s
}

fn usb_block(events: &[Event]) -> String {
    let rows: Vec<&Event> = events.iter().filter(|e| bucket(e) == "USB").collect();
    let mut s = format!(
        "<h2>USB activity ({})</h2>\n<table>\n<tr><th>Time</th><th>Event</th><th>Device / File</th></tr>\n",
        rows.len()
    );
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
        s.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td>{}</td></tr>\n",
            html_escape(&ev.timestamp.format(TS_FMT).to_string()),
            kind,
            html_escape(detail.trim())
        ));
    }
    s.push_str("</table>\n");
    s
}

fn network_block(events: &[Event]) -> String {
    let rows: Vec<&Event> = events.iter().filter(|e| bucket(e) == "Network").collect();
    let mut s = format!(
        "<h2>Network connections ({})</h2>\n<table>\n<tr><th>Time</th><th>Destination</th><th>Process</th></tr>\n",
        rows.len()
    );
    for ev in rows {
        let dest = format!(
            "{}:{}",
            meta_str(ev, "remote_ip").unwrap_or_default(),
            meta_str(ev, "remote_port").unwrap_or_default()
        );
        s.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td>{}</td></tr>\n",
            html_escape(&ev.timestamp.format(TS_FMT).to_string()),
            html_escape(dest.trim_end_matches(':')),
            html_escape(&meta_str(ev, "process_name").unwrap_or_default())
        ));
    }
    s.push_str("</table>\n");
    s
}

// ---------------------------------------------------------------------------
// Event -> human-readable description (mirrors dashboard TelemetryExplorer)
// ---------------------------------------------------------------------------

/// One-line plain-English description (escaped by the caller before insertion).
pub fn describe_event(ev: &Event) -> String {
    let t = ev.event_type.to_lowercase();
    let m = |k: &str| meta_str(ev, k).unwrap_or_default();

    if t == "screenshot_captured" {
        format!("Screenshot captured ({}x{}, {})", m("width"), m("height"), m("format"))
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
            meta_str(ev, "filename").or_else(|| meta_str(ev, "file_name")).unwrap_or_default(),
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
        format!("Process started: {} (pid {}) {}", m("process_name"), m("pid"), m("executable_path"))
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

/// Render the browser "detail" cell: a clickable link for http(s)/ftp URLs (escaped),
/// otherwise plain escaped text. Falls back to plain text for unsafe schemes.
fn render_url_detail(url: Option<&str>, label: &str) -> String {
    let label_html = if label.is_empty() {
        String::new()
    } else {
        format!(" — {}", html_escape(&truncate(label, 80)))
    };
    match url {
        Some(u) if !u.is_empty() => match safe_href(u) {
            Some(href) => format!(
                "<a href=\"{}\" target=\"_blank\" rel=\"noopener noreferrer\">{}</a>{}",
                href,
                html_escape(&truncate(u, 90)),
                label_html
            ),
            None => format!("{}{}", html_escape(&truncate(u, 90)), label_html),
        },
        _ => html_escape(label),
    }
}

/// Escape href for use in a double-quoted attribute, but only for safe schemes.
fn safe_href(url: &str) -> Option<String> {
    let lower = url.trim().to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("ftp://") {
        Some(html_escape(url.trim()))
    } else {
        None
    }
}

fn html_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

fn kv_row(key: &str, value: &str) -> String {
    format!("<tr><td>{}</td><td>{}</td></tr>\n", html_escape(key), html_escape(value))
}

fn window_str(events: &[Event]) -> String {
    match (events.first(), events.last()) {
        (Some(f), Some(l)) => format!(
            "{} — {} UTC",
            f.timestamp.format(TS_FMT),
            l.timestamp.format(TS_FMT)
        ),
        _ => "—".to_string(),
    }
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

/// Decode, downscale, re-encode as JPEG, and base64 into a data URI for inline embedding.
fn screenshot_to_data_uri(path: &Path, max_w: u32) -> anyhow::Result<String> {
    let jpeg = screenshot_to_jpeg(path, max_w)?;
    Ok(format!("data:image/jpeg;base64,{}", BASE64.encode(&jpeg)))
}

fn screenshot_to_jpeg(path: &Path, max_w: u32) -> anyhow::Result<Vec<u8>> {
    let img = image::open(path)?;
    let img = if img.width() > max_w {
        img.resize(max_w, u32::MAX, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let rgb = image::DynamicImage::ImageRgb8(img.to_rgb8());
    let mut cur = std::io::Cursor::new(Vec::new());
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
