//! Turn a raw `agent.log` into a short list of plain-language "problems" that a
//! non-technical admin can read. It pattern-matches known log signatures and maps
//! them to friendly sentences; any line that is clearly an error but unmatched is
//! surfaced generically so nothing is hidden. Pure logic (no DB) — the "problems"
//! are always derived from the actual log text the agent uploaded.
//!
//! Output: JSON objects shaped `{ "severity": "error"|"warning", "title": "...",
//! "detail": "..." }`, errors first, capped so the report stays readable.

use serde_json::json;
use std::collections::BTreeMap;

struct Rule {
    needles: &'static [&'static str],
    severity: &'static str,
    title: &'static str,
}

const RULES: &[Rule] = &[
    Rule {
        needles: &[
            "os error 10060", "connection refused", "error sending request", "dns error",
            "Heartbeat failed", "Enrollment request failed", "failed to lookup address",
            "os error 11001", "timed out",
        ],
        severity: "error",
        title: "Couldn't reach the server (network or connectivity issue).",
    },
    Rule {
        needles: &["Enrollment denied", "token was rejected", "Enrollment failed"],
        severity: "error",
        title: "The server rejected the enrollment token.",
    },
    Rule {
        needles: &[
            "Failed to save screenshot", "Failed to create helper screenshot",
            "Failed to save screenshot to disk",
        ],
        severity: "error",
        title: "Couldn't save screenshots (a permissions or disk problem).",
    },
    Rule {
        needles: &["Capture failed", "Failed to list screens"],
        severity: "warning",
        title: "Screen capture failed on one or more attempts.",
    },
    Rule {
        needles: &["service entry is missing", "tampering", "tamper"],
        severity: "error",
        title: "The monitoring service was missing (possible removal or tampering).",
    },
    Rule {
        needles: &["panic", "CRASHED", "FATAL"],
        severity: "error",
        title: "The agent crashed and was restarted automatically.",
    },
    Rule {
        needles: &["Could not copy history file"],
        severity: "warning",
        title: "Couldn't read browser history (the browser may have been open).",
    },
    Rule {
        needles: &["Access is denied", "os error 5"],
        severity: "warning",
        title: "A permissions error occurred accessing a file.",
    },
];

/// Pull HH:MM out of a tracing line that starts with an ISO timestamp like
/// `2026-11-13T14:09:14.670063Z`.
fn extract_hm(line: &str) -> Option<String> {
    let t = line.find('T')?;
    let rest = line.get(t + 1..t + 6)?; // "HH:MM"
    if rest.len() == 5 && rest.as_bytes().get(2) == Some(&b':') {
        Some(rest.to_string())
    } else {
        None
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() > max {
        let t: String = s.chars().take(max).collect();
        format!("{}\u{2026}", t)
    } else {
        s.to_string()
    }
}

pub fn parse_log_problems(log: &str) -> Vec<serde_json::Value> {
    struct Agg {
        severity: &'static str,
        title: &'static str,
        count: u32,
        first: Option<String>,
        last: Option<String>,
    }
    let mut aggs: BTreeMap<&'static str, Agg> = BTreeMap::new();
    let mut generic: Vec<(Option<String>, String)> = Vec::new();

    for line in log.lines() {
        let is_error =
            line.contains(" ERROR ") || line.contains("ERROR ") || line.contains("error:");
        let mut matched = false;
        for rule in RULES {
            if rule.needles.iter().any(|n| line.contains(n)) {
                let hm = extract_hm(line);
                let e = aggs.entry(rule.title).or_insert(Agg {
                    severity: rule.severity,
                    title: rule.title,
                    count: 0,
                    first: None,
                    last: None,
                });
                e.count += 1;
                if e.first.is_none() {
                    e.first = hm.clone();
                }
                if hm.is_some() {
                    e.last = hm;
                }
                matched = true;
                break;
            }
        }
        if !matched && is_error {
            generic.push((extract_hm(line), line.trim().to_string()));
        }
    }

    let mut out: Vec<serde_json::Value> = Vec::new();
    for (_title, a) in aggs {
        let detail = match (a.first.as_ref(), a.last.as_ref(), a.count) {
            (Some(f), Some(l), n) if f != l => format!("seen {} times, {}\u{2013}{}", n, f, l),
            (Some(f), _, n) if n > 1 => format!("seen {} times, from {}", n, f),
            (Some(f), _, _) => format!("at {}", f),
            _ => format!("seen {} time(s)", a.count),
        };
        out.push(json!({ "severity": a.severity, "title": a.title, "detail": detail }));
    }

    // Surface a few of the most recent unmatched errors verbatim, then summarize the rest.
    if !generic.is_empty() {
        let total = generic.len();
        for (hm, sample) in generic.iter().rev().take(3) {
            let at = hm.clone().map(|h| format!(" at {}", h)).unwrap_or_default();
            out.push(json!({
                "severity": "error",
                "title": "An error was logged.",
                "detail": format!("{}{}", truncate_chars(sample, 160), at),
            }));
        }
        if total > 3 {
            out.push(json!({
                "severity": "warning",
                "title": format!("{} more error lines in the full log.", total - 3),
                "detail": "Open the technical log for details.",
            }));
        }
    }

    out.sort_by(|a, b| {
        let rank = |v: &serde_json::Value| if v["severity"] == "error" { 0 } else { 1 };
        rank(a).cmp(&rank(b))
    });
    out
}
