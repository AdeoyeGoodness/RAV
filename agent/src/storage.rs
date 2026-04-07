use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tracing::{info, error, debug};
use crate::sync::Event;

pub struct StorageManager {
    // Ideally we'd use a pool or a dedicated thread, but Mutex is fine for this throughput.
    conn: Arc<Mutex<Connection>>,
}

impl StorageManager {
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        let db_path = data_dir.join("rav_events.db");
        info!("Initializing Persistent Storage at {:?}", db_path);

        let conn = Connection::open(&db_path)
            .context("Failed to open SQLite database")?;

        // Performance Pragmas
        conn.execute_batch("
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;
        ")?;

        let manager = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        manager.init_schema()?;
        Ok(manager)
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                payload TEXT NOT NULL,
                synced BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        ).context("Failed to create events table")?;
        
        // Index for faster sync queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_synced_timestamp ON events(synced, timestamp)",
            [],
        )?;

        // State table for persistence (Item 6.2)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS state (
                k TEXT PRIMARY KEY,
                v TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        ).context("Failed to create state table")?;

        Ok(())
    }

    pub fn save_state(&self, key: &str, value: &serde_json::Value) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let val_str = serde_json::to_string(value)?;
        conn.execute(
            "INSERT INTO state (k, v) VALUES (?1, ?2) 
             ON CONFLICT(k) DO UPDATE SET v=?2, updated_at=CURRENT_TIMESTAMP",
            params![key, val_str],
        )?;
        Ok(())
    }

    pub fn load_state(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT v FROM state WHERE k = ?")?;
        let mut rows = stmt.query([key])?;
        if let Some(row) = rows.next()? {
            let v: String = row.get(0)?;
            Ok(Some(serde_json::from_str(&v)?))
        } else {
            Ok(None)
        }
    }

    pub fn save_event(&self, event: &Event) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let payload = serde_json::to_string(event)
            .context("Failed to serialize event payload")?;

        conn.execute(
            "INSERT INTO events (event_type, timestamp, payload, synced) VALUES (?1, ?2, ?3, 0)",
            params![
                event.event_type,
                event.timestamp.to_rfc3339(),
                payload
            ],
        ).context("Failed to insert event into DB")?;
        
        debug!("Event saved to disk: {}", event.event_type);
        Ok(())
    }

    pub fn fetch_unsynced_events(&self, limit: usize) -> Result<Vec<(i64, Event)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, payload FROM events WHERE synced = 0 ORDER BY timestamp ASC LIMIT ?"
        )?;

        let rows = stmt.query_map([limit], |row| {
            let id: i64 = row.get(0)?;
            let payload: String = row.get(1)?;
            Ok((id, payload))
        })?;

        let mut events = Vec::new();
        for row in rows {
            let (id, payload_str) = row?;
            match serde_json::from_str::<Event>(&payload_str) {
                Ok(event) => events.push((id, event)),
                Err(e) => error!("Failed to deserialize event ID {}: {}", id, e),
            }
        }

        Ok(events)
    }

    pub fn mark_synced(&self, ids: &[i64]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }

        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        // Rusqlite doesn't support array params purely, so we iterate (batch is okay)
        // Or we loop. For 100 items, loop is fine in a transaction.
        {
            let mut stmt = tx.prepare("UPDATE events SET synced = 1 WHERE id = ?")?;
            for id in ids {
                stmt.execute([id])?;
            }
        }
        
        tx.commit()?;
        Ok(())
    }

    // Optional: Delete flushed events to keep DB small (as requested by User)
    pub fn prune_synced_events(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute(
            "DELETE FROM events WHERE synced = 1",
            [],
        )?;
        if count > 0 {
            info!("Pruned {} synced events from disk", count);
        }
        Ok(count)
    }
}
