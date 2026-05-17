use anyhow::Result;
use chrono::{DateTime, Utc};
use serde_json::json;
use std::sync::Arc;
use std::path::Path;
use tokio::time::{interval, Duration};
use tracing::{error, info, debug};
use rusqlite::{Connection, OpenFlags};

use crate::config::Config;
use crate::sync::{Event, SyncManager};

pub async fn start_monitoring(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    if !config.monitoring.browser.enabled {
        info!("Browser history monitoring is disabled");
        return Ok(());
    }

    info!("Starting forensic browser history monitoring (offline scraper)");

    let interval_mins = config.monitoring.browser.scrape_interval_minutes;
    let mut interval_timer = interval(Duration::from_secs(interval_mins * 60));
    
    loop {
        interval_timer.tick().await;
        
        #[cfg(windows)]
        {
            if let Err(e) = scrape_windows_browsers(sync_manager.clone()).await {
                error!("Browser scraping error: {}", e);
            }
        }
    }
}

#[cfg(windows)]
async fn scrape_windows_browsers(sync_manager: Arc<SyncManager>) -> Result<()> {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if local_app_data.is_empty() { return Ok(()); }

    let browsers = vec![
        ("Chrome", format!("{}\\Google\\Chrome\\User Data", local_app_data)),
        ("Edge", format!("{}\\Microsoft\\Edge\\User Data", local_app_data)),
    ];

    for (name, path) in browsers {
        let base_path = Path::new(&path);
        if !base_path.exists() { continue; }

        // Check Default and Profile X folders
        let profiles = vec!["Default", "Profile 1", "Profile 2", "Profile 3"];
        for profile in profiles {
            let history_path = base_path.join(profile).join("History");
            if history_path.exists() {
                if let Err(e) = scrape_history_file(&history_path, name, profile, sync_manager.clone()).await {
                    debug!("Failed to scrape {} history for {}: {}", name, profile, e);
                }
            }
        }
    }

    Ok(())
}

#[cfg(windows)]
async fn scrape_history_file(
    path: &Path, 
    browser: &str, 
    profile: &str,
    sync_manager: Arc<SyncManager>
) -> Result<()> {
    let storage = sync_manager.get_storage();
    let state_key = format!("browser_last_ts_{}_{}", browser, profile);
    
    // 1. Load last processed timestamp (Webkit format)
    let last_ts: i64 = match storage.load_state(&state_key) {
        Ok(Some(serde_json::Value::Number(n))) => n.as_i64().unwrap_or(0),
        _ => {
            // Default to 1 hour ago on first run
            let one_hour_ago = Utc::now() - chrono::Duration::hours(1);
            (one_hour_ago.timestamp() + 11644473600) * 1000000
        }
    };

    // 2. Copy file to temp to avoid locking
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(format!("rav_hist_{}_{}.db", browser, profile));
    if let Err(e) = std::fs::copy(path, &temp_path) {
        debug!("Could not copy history file (likely in use): {}", e);
        return Ok(());
    }

    let mut newest_ts = last_ts;
    let mut results = Vec::new();

    {
        // 3. Open SQLite (read-only)
        let conn = Connection::open_with_flags(&temp_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;

        // 4. Query only NEW history
        let mut stmt = conn.prepare(
            "SELECT url, title, visit_count, last_visit_time FROM urls 
             WHERE last_visit_time > ? 
             ORDER BY last_visit_time ASC LIMIT 100"
        )?;

        let rows = stmt.query_map([last_ts], |row| {
            let url: String = row.get(0)?;
            let title: String = row.get(1)?;
            let visit_count: i32 = row.get(2)?;
            let last_visit_time: i64 = row.get(3)?;
            
            Ok((url, title, visit_count, last_visit_time))
        })?;

        for row in rows {
            if let Ok(data) = row {
                results.push(data);
            }
        }
    }

    let (agent_id, _) = sync_manager.get_identity().await;

    if !results.is_empty() {
        info!("Scraped {} new {} visits for {}", results.len(), browser, profile);
    }

    for (url, title, visit_cnt, ts_raw) in results {
        // Convert Webkit to UTC
        let unix_ts = (ts_raw / 1000000) - 11644473600;
        let timestamp = DateTime::<Utc>::from_utc(
            chrono::NaiveDateTime::from_timestamp_opt(unix_ts, 0).unwrap_or_default(), 
            Utc
        );

        sync_manager.queue_event(Event {
            event_type: "browser_history_visit".to_string(),
            timestamp,
            agent_id: agent_id.clone(),
            metadata: json!({
                "url": url,
                "title": title,
                "visit_count": visit_cnt,
                "browser": browser,
                "profile": profile,
                "source": "forensic_scraper"
            }),
        });
        
        if ts_raw > newest_ts {
            newest_ts = ts_raw;
        }
    }

    // 5. Update state if we found new visits
    if newest_ts > last_ts {
        let _ = storage.save_state(&state_key, &json!(newest_ts));
    }

    // 6. Cleanup
    let _ = std::fs::remove_file(temp_path);

    Ok(())
}
