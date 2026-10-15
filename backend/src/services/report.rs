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
    critical_ids: &std::collections::HashSet<String>,
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
        body.push_str(&screenshots_block(events, file_storage_dir, max_screenshots, critical_ids));
        reports.push((
            "screenshots.html".to_string(),
            wrap_html("Critical Screenshots", &body).into_bytes(),
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

/// Shared stylesheet for every report section. Kept as its own const (normal CSS
/// braces) so `wrap_html`'s format! template doesn't have to escape them.
const REPORT_STYLE: &str = r##"
  :root{
    --ink:#0d0f14; --ink2:#363b47; --muted:#6b7280; --faint:#9aa1ad;
    --bg:#eef0f4; --surface:#ffffff; --line:#e3e6ec; --line2:#eef0f4;
    --accent:#3b5bdb; --crit:#c0362c; --crit-soft:#fdecea;
    --warn:#b45309; --warn-soft:#fdf3e7; --ok:#15803d;
  }
  *{ box-sizing:border-box; }
  html{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body{ margin:0; color:var(--ink); background:var(--bg); font-size:14px; line-height:1.5;
        font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .mono{ font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; }

  header.brand{ background:linear-gradient(135deg,#0b0e18,#141a2e); color:#fff; padding:26px 32px; }
  header.brand .row{ max-width:1060px; margin:0 auto; display:flex; align-items:center;
                     justify-content:space-between; gap:16px; flex-wrap:wrap; }
  header.brand .mark{ font-size:11px; letter-spacing:.34em; color:#8893ad; text-transform:uppercase; }
  header.brand h1{ font-size:22px; margin:5px 0 0; letter-spacing:.01em; font-weight:700; }
  header.brand .sub{ color:#aab2c5; font-size:12px; margin-top:6px; text-transform:uppercase; letter-spacing:.16em; }
  .pill{ display:inline-block; font-size:10.5px; font-weight:700; letter-spacing:.18em; text-transform:uppercase;
         padding:6px 13px; border-radius:999px; background:rgba(192,54,44,.16); color:#ff8278; border:1px solid rgba(255,130,120,.4); }

  .container{ max-width:1060px; margin:0 auto; padding:30px 32px 24px; }

  h2{ font-size:12px; text-transform:uppercase; letter-spacing:.16em; color:var(--muted);
      margin:34px 0 14px; display:flex; align-items:center; gap:10px; }
  h2::before{ content:""; width:14px; height:2px; background:var(--accent); border-radius:2px; }
  h2:first-child{ margin-top:0; }

  .card{ background:var(--surface); border:1px solid var(--line); border-radius:10px; box-shadow:0 1px 2px rgba(16,20,40,.04); }
  .card.pad{ padding:18px 20px; }

  .meta{ display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:1px;
         background:var(--line); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .meta .cell{ background:var(--surface); padding:14px 18px; }
  .meta .k{ font-size:10px; text-transform:uppercase; letter-spacing:.14em; color:var(--faint); }
  .meta .v{ font-size:14px; color:var(--ink); margin-top:5px; word-break:break-word; font-weight:600; }

  .stats{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
  .stat{ background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:16px 18px; box-shadow:0 1px 2px rgba(16,20,40,.04); }
  .stat .n{ font-size:28px; font-weight:750; letter-spacing:-.02em; line-height:1; font-variant-numeric:tabular-nums; }
  .stat .l{ font-size:10px; text-transform:uppercase; letter-spacing:.13em; color:var(--muted); margin-top:9px; }
  .stat.crit .n{ color:var(--crit); } .stat.warn .n{ color:var(--warn); }

  .bars{ display:flex; flex-direction:column; gap:11px; }
  .bar{ display:grid; grid-template-columns:140px 1fr 86px; align-items:center; gap:12px; }
  .bar .cat{ font-size:12.5px; font-weight:600; display:flex; align-items:center; gap:8px; }
  .bar .dot{ width:9px; height:9px; border-radius:3px; flex:none; }
  .bar .track{ height:9px; background:var(--line2); border-radius:999px; overflow:hidden; }
  .bar .fill{ height:100%; border-radius:999px; }
  .bar .num{ text-align:right; font-size:12px; color:var(--ink2); font-variant-numeric:tabular-nums; }

  .alert{ padding:12px 16px; border-radius:9px; font-size:13px; margin-top:12px; }
  .alert.crit{ background:var(--crit-soft); border:1px solid #f3c6c1; color:#8f241c; }
  .alert.warn{ background:var(--warn-soft); border:1px solid #f0d6ad; color:#834406; }
  .warn{ color:var(--crit); font-weight:700; }

  .classified{ margin-top:18px; padding:13px 16px; border-radius:9px; font-size:12px; line-height:1.55;
               background:#11131c; color:#c9cedb; border:1px solid #23283a; }
  .classified .tag{ color:#ff8278; font-weight:700; letter-spacing:.08em; margin-right:8px; }

  .timeline{ border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--surface); }
  .tl{ display:grid; grid-template-columns:168px 10px 1fr; align-items:baseline; gap:10px;
       padding:7px 16px; border-bottom:1px solid var(--line2); }
  .tl:last-child{ border-bottom:none; }
  .tl:nth-child(even){ background:#fafbfc; }
  .tl .t{ font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; color:var(--muted);
          white-space:nowrap; font-variant-numeric:tabular-nums; }
  .tl .d{ width:7px; height:7px; border-radius:2px; align-self:center; }
  .tl .e{ font-size:12.5px; color:var(--ink2); word-break:break-word; }

  table{ width:100%; border-collapse:collapse; font-size:13px; background:var(--surface);
         border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th,td{ text-align:left; padding:9px 13px; border-bottom:1px solid var(--line2); vertical-align:top; }
  th{ background:#f3f5f9; font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; color:#5a6276; }
  tr:last-child td{ border-bottom:none; }
  a{ color:var(--accent); word-break:break-all; }
  .kv td:first-child{ color:var(--muted); width:180px; font-weight:600; }
  .muted{ color:var(--muted); font-size:12.5px; }

  .gallery{ display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:18px; }
  .gallery figure{ margin:0; }
  .gallery img{ max-width:100%; border:1px solid var(--line); border-radius:8px; display:block; }
  .gallery figcaption{ font-size:11.5px; color:var(--muted); margin-bottom:7px; font-family:ui-monospace,Menlo,Consolas,monospace; }

  footer.foot{ max-width:1060px; margin:34px auto 0; padding:18px 32px 40px; color:var(--faint);
               font-size:11px; text-align:center; letter-spacing:.04em; border-top:1px solid var(--line); }

  @media print{
    body{ background:#fff; }
    .card,.stat,.meta,.timeline,table{ box-shadow:none; }
    h2{ break-after:avoid; }
    .tl,.bar,.stat,figure{ break-inside:avoid; }
  }
"##;

fn wrap_html(section_title: &str, body: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RAV Forensic — {title}</title>
<style>{style}</style>
</head>
<body>
<header class="brand">
  <div class="row">
    <div>
      <div class="mark">RAV · Digital Forensics Platform</div>
      <h1>Forensic Evidence Report</h1>
      <div class="sub">{title}</div>
    </div>
    <span class="pill">Confidential</span>
  </div>
</header>
<div class="container">
{body}
</div>
<footer class="foot">RAV Forensic Report · generated {gen} UTC · handle per evidence-retention policy</footer>
</body>
</html>"#,
        title = html_escape(section_title),
        style = REPORT_STYLE,
        gen = Utc::now().format(TS_FMT),
        body = body
    )
}

fn cover_block(agent_id: &str, host: &str, org: &str, events: &[Event]) -> String {
    let host_label = if host.is_empty() { agent_id } else { host };
    let window = window_str(events);
    let mut s = String::new();
    s.push_str("<h2>Case overview</h2>\n<div class=\"meta\">\n");
    s.push_str(&meta_cell("Endpoint", host_label));
    s.push_str(&meta_cell("Agent ID", agent_id));
    if !org.is_empty() {
        s.push_str(&meta_cell("Organization", org));
    }
    s.push_str(&meta_cell("Coverage window", &window));
    s.push_str(&meta_cell("Total events", &format_num(events.len())));
    s.push_str(&meta_cell("Report generated", &format!("{} UTC", Utc::now().format(TS_FMT))));
    s.push_str("</div>\n");
    s.push_str(
        "<div class=\"classified\"><span class=\"tag\">CONFIDENTIAL</span>\
         Evidence copy — handle per evidence-retention policy. This archive is a point-in-time \
         snapshot of the endpoint's telemetry for the coverage window above; the live platform \
         retains its own recent copy independently.</div>\n",
    );
    s
}

fn meta_cell(k: &str, v: &str) -> String {
    format!(
        "<div class=\"cell\"><div class=\"k\">{}</div><div class=\"v\">{}</div></div>\n",
        html_escape(k),
        html_escape(v)
    )
}

/// Thousands-separated integer for human-readable counts (e.g. 20000 -> "20,000").
fn format_num(n: usize) -> String {
    let digits = n.to_string();
    let len = digits.len();
    let mut out = String::with_capacity(len + len / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Stable accent colour per activity category (shared by the breakdown bars and the
/// timeline dots) so the two read as one system.
fn category_color(cat: &str) -> &'static str {
    match cat {
        "Screenshots" => "#3b5bdb",
        "Browser" => "#0ea5e9",
        "USB" => "#d97706",
        "Network" => "#14b8a6",
        "Wi-Fi" => "#8b5cf6",
        "Processes" => "#64748b",
        "Offline gaps" => "#b45309",
        "Audit" => "#15803d",
        _ => "#9aa1ad",
    }
}

fn stat_card(kind: &str, number: &str, label: &str) -> String {
    let cls = if kind.is_empty() { "stat".to_string() } else { format!("stat {}", kind) };
    format!(
        "<div class=\"{cls}\"><div class=\"n\">{n}</div><div class=\"l\">{l}</div></div>\n",
        cls = cls,
        n = html_escape(number),
        l = html_escape(label)
    )
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

    let total = events.len();
    let browser = *counts.get("Browser").unwrap_or(&0);
    let screenshots = *counts.get("Screenshots").unwrap_or(&0);

    let mut s = String::from("<h2>Executive summary</h2>\n<div class=\"stats\">\n");
    s.push_str(&stat_card("", &format_num(total), "Total events"));
    s.push_str(&stat_card("", &format_num(browser), "Browser events"));
    s.push_str(&stat_card("", &format_num(screenshots), "Screenshots"));
    s.push_str(&stat_card("", &counts.len().to_string(), "Categories"));
    if blind_spots > 0 {
        s.push_str(&stat_card("warn", &format_num(blind_spots), "Offline gaps"));
    }
    if failed_uploads > 0 {
        s.push_str(&stat_card("crit", &format_num(failed_uploads), "Upload failures"));
    }
    s.push_str("</div>\n");

    // Activity breakdown — proportional bars, biggest category first.
    if total > 0 && !counts.is_empty() {
        let max = counts.values().copied().max().unwrap_or(1).max(1);
        let mut cats: Vec<(&'static str, usize)> = counts.iter().map(|(k, v)| (*k, *v)).collect();
        cats.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        s.push_str("<h2>Activity breakdown</h2>\n<div class=\"card pad\"><div class=\"bars\">\n");
        for (cat, n) in cats {
            let pct = ((n as f64 / total as f64) * 100.0).round() as u64;
            let width = ((n as f64 / max as f64) * 100.0).round() as u64;
            let color = category_color(cat);
            s.push_str(&format!(
                "<div class=\"bar\"><div class=\"cat\"><span class=\"dot\" style=\"background:{c}\"></span>{name}</div>\
                 <div class=\"track\"><div class=\"fill\" style=\"width:{w}%;background:{c}\"></div></div>\
                 <div class=\"num\">{n} · {pct}%</div></div>\n",
                c = color,
                name = html_escape(cat),
                w = width,
                n = format_num(n),
                pct = pct
            ));
        }
        s.push_str("</div></div>\n");
    }

    if blind_spots > 0 {
        s.push_str(&format!(
            "<div class=\"alert warn\"><b>⚠ {} telemetry blind spot(s)</b> — the agent reported \
             offline periods; activity during those gaps was not captured.</div>\n",
            format_num(blind_spots)
        ));
    }
    if failed_uploads > 0 {
        s.push_str(&format!(
            "<div class=\"alert crit\"><b>⚠ {} screenshot upload failure(s)</b> — the corresponding \
             image(s) may be unavailable.</div>\n",
            format_num(failed_uploads)
        ));
    }
    s
}

fn timeline_block(events: &[Event]) -> String {
    // Cap the inline timeline so a large window doesn't produce a multi-MB overview;
    // the complete, unabridged timeline is always in events.json. Show the MOST RECENT
    // TIMELINE_MAX (events arrive oldest-first), kept in chronological order.
    const TIMELINE_MAX: usize = 2000;
    let total = events.len();
    let shown: &[Event] = if total > TIMELINE_MAX {
        &events[total - TIMELINE_MAX..]
    } else {
        events
    };

    let mut s = String::from("<h2>Chronological timeline</h2>\n");
    if total > TIMELINE_MAX {
        s.push_str(&format!(
            "<p class=\"muted\">Showing the most recent {} of {} events — the complete timeline is in \
             <span class=\"mono\">events.json</span>.</p>\n",
            format_num(TIMELINE_MAX),
            format_num(total)
        ));
    }
    s.push_str("<div class=\"timeline\">\n");
    for ev in shown {
        s.push_str(&format!(
            "<div class=\"tl\"><span class=\"t\">{}</span><span class=\"d\" style=\"background:{}\"></span><span class=\"e\">{}</span></div>\n",
            ev.timestamp.format(TS_FMT),
            category_color(bucket(ev)),
            html_escape(&describe_event(ev))
        ));
    }
    s.push_str("</div>\n");
    s
}

fn screenshots_block(events: &[Event], dir: &Path, max: usize, critical_ids: &std::collections::HashSet<String>) -> String {
    // Embed ONLY critical (OCR-flagged) screenshots inline. The base64 gallery is
    // what made archiving slow, and these are the evidence that matters. Every
    // screenshot still lives in the files store + events.json, and the critical ones
    // are also bundled as separate image files in the archive (critical_screenshots/).
    let shots: Vec<&Event> = events
        .iter()
        .filter(|e| e.event_type.eq_ignore_ascii_case("screenshot_captured"))
        .filter(|e| meta_str(e, "file_id").map(|id| critical_ids.contains(&id)).unwrap_or(false))
        .collect();

    if shots.is_empty() {
        return "<h2>Critical Screenshots</h2>\n<p class=\"muted\">No OCR-flagged screenshots in this window.</p>\n".to_string();
    }

    let mut s = format!("<h2>Critical Screenshots ({})</h2>\n<div class=\"gallery\">\n", shots.len());
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
