/**
 * RAV Browser Extension - Type Definitions
 *
 * Defines the data structures for browser activity events
 * that are sent to the local RAV agent.
 */
export const DEFAULT_CONFIG = {
    agent_url: 'http://127.0.0.1:8089/api/extension/events',
    sync_interval_seconds: 30,
    max_batch_size: 100,
    collect_active_tabs: true,
    collect_history: true,
    collect_downloads: true,
    max_history_age_days: 7
};
//# sourceMappingURL=types.js.map