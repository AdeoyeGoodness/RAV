/**
 * RAV Browser Extension - Type Definitions
 * 
 * Defines the data structures for browser activity events
 * that are sent to the local RAV agent.
 */

// ============================================================================
// Event Types
// ============================================================================

export type BrowserEventType =
    | 'active_tab'
    | 'tab_updated'
    | 'history_visit'
    | 'search_query'
    | 'download_started'
    | 'download_completed'
    | 'download_failed';

// ============================================================================
// Base Event Structure
// ============================================================================

export interface BrowserEvent {
    /** Unique event ID (UUID) */
    event_id: string;

    /** Type of browser event */
    event_type: BrowserEventType;

    /** UTC timestamp in ISO 8601 format */
    timestamp: string;

    /** Browser name (chrome, edge, firefox) */
    browser: string;

    /** Browser profile name if available */
    profile?: string;

    /** Event-specific data */
    data: ActiveTabData | HistoryVisitData | SearchQueryData | DownloadData;
}

// ============================================================================
// Active Tab Event
// ============================================================================

export interface ActiveTabData {
    /** Tab ID */
    tab_id: number;

    /** Window ID */
    window_id: number;

    /** Full URL of the active tab */
    url: string;

    /** Page title */
    title: string;

    /** Favicon URL if available */
    favicon_url?: string;

    /** Whether the tab is incognito/private */
    incognito: boolean;
}

// ============================================================================
// History Visit Event
// ============================================================================

export interface HistoryVisitData {
    /** Full URL that was visited */
    url: string;

    /** Page title */
    title: string;

    /** Visit timestamp (from browser history) */
    visit_time: string;

    /** How the page was reached (link, typed, etc.) */
    transition_type?: string;

    /** Number of times this URL has been visited */
    visit_count?: number;
}

// ============================================================================
// Search Query Event
// ============================================================================

export interface SearchQueryData {
    /** The search query text */
    query: string;

    /** Full URL of the search */
    url: string;

    /** Search engine used (google, bing, duckduckgo, etc.) */
    search_engine: string;

    /** Timestamp of the search */
    search_time: string;
}

// ============================================================================
// Download Event
// ============================================================================

export interface DownloadData {
    /** Browser's download ID */
    download_id: number;

    /** Original filename */
    filename: string;

    /** Full local path where file is saved */
    file_path?: string;

    /** Source URL of the download */
    source_url: string;

    /** Referrer URL if available */
    referrer_url?: string;

    /** File size in bytes */
    file_size: number;

    /** MIME type of the file */
    mime_type?: string;

    /** Download state: in_progress, complete, interrupted */
    state: 'in_progress' | 'complete' | 'interrupted' | 'cancelled';

    /** Start time of download */
    start_time: string;

    /** End time of download (if completed) */
    end_time?: string;

    /** Error message if download failed */
    error?: string;
}

// ============================================================================
// Agent Communication
// ============================================================================

export interface AgentPayload {
    /** Batch of events to send */
    events: BrowserEvent[];

    /** Extension version */
    extension_version: string;

    /** Timestamp when batch was created */
    batch_timestamp: string;
}

export interface AgentResponse {
    /** Whether the agent accepted the events */
    success: boolean;

    /** Number of events processed */
    events_processed: number;

    /** Error message if any */
    error?: string;
}

// ============================================================================
// Extension Configuration
// ============================================================================

export interface ExtensionConfig {
    /** Agent endpoint URL (localhost only) */
    agent_url: string;

    /** How often to sync with agent (seconds) */
    sync_interval_seconds: number;

    /** Maximum events to batch before forced sync */
    max_batch_size: number;

    /** Whether to collect active tab events */
    collect_active_tabs: boolean;

    /** Whether to collect history events */
    collect_history: boolean;

    /** Whether to collect download events */
    collect_downloads: boolean;

    /** Maximum history age to sync (days) */
    max_history_age_days: number;
}

export const DEFAULT_CONFIG: ExtensionConfig = {
    agent_url: 'http://127.0.0.1:8089/api/extension/events',
    sync_interval_seconds: 30,
    max_batch_size: 100,
    collect_active_tabs: true,
    collect_history: true,
    collect_downloads: true,
    max_history_age_days: 7
};
