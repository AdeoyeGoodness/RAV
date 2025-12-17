/**
 * RAV Browser Extension - Event Collectors
 * 
 * Collects browser activity events:
 * - Active tab changes
 * - History visits
 * - Download events
 */

import {
    BrowserEvent,
    ActiveTabData,
    HistoryVisitData,
    DownloadData
} from './types.js';
import {
    generateUUID,
    getUTCTimestamp,
    detectBrowser,
    shouldTrackUrl,
    extractFilename
} from './utils.js';
import { agentClient } from './agent-client.js';

const BROWSER = detectBrowser();

// ============================================================================
// Active Tab Collector
// ============================================================================

/**
 * Initialize active tab monitoring
 */
export function initActiveTabCollector(): void {
    console.log('[RAV] Initializing active tab collector');

    // Listen for tab activation (user switches tabs)
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
        try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            if (tab && shouldTrackUrl(tab.url)) {
                const event = createActiveTabEvent(tab, activeInfo.windowId);
                agentClient.queueEvent(event);
            }
        } catch (error) {
            console.error('[RAV] Error handling tab activation:', error);
        }
    });

    // Listen for tab updates (URL changes within same tab)
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        // Only track when URL changes and page is complete
        if (changeInfo.status === 'complete' && changeInfo.url && shouldTrackUrl(changeInfo.url)) {
            try {
                const event = createActiveTabEvent(tab, tab.windowId);
                event.event_type = 'tab_updated';
                agentClient.queueEvent(event);
            } catch (error) {
                console.error('[RAV] Error handling tab update:', error);
            }
        }
    });

    console.log('[RAV] Active tab collector initialized');
}

function createActiveTabEvent(tab: chrome.tabs.Tab, windowId: number): BrowserEvent {
    const data: ActiveTabData = {
        tab_id: tab.id ?? 0,
        window_id: windowId,
        url: tab.url ?? '',
        title: tab.title ?? '',
        favicon_url: tab.favIconUrl,
        incognito: tab.incognito
    };

    return {
        event_id: generateUUID(),
        event_type: 'active_tab',
        timestamp: getUTCTimestamp(),
        browser: BROWSER,
        data
    };
}

// ============================================================================
// History Collector
// ============================================================================

/**
 * Initialize history monitoring
 */
export function initHistoryCollector(): void {
    console.log('[RAV] Initializing history collector');

    // Listen for new history visits
    chrome.history.onVisited.addListener((result) => {
        if (shouldTrackUrl(result.url)) {
            const event = createHistoryEvent(result);
            agentClient.queueEvent(event);
        }
    });

    console.log('[RAV] History collector initialized');
}

function createHistoryEvent(item: chrome.history.HistoryItem): BrowserEvent {
    const data: HistoryVisitData = {
        url: item.url ?? '',
        title: item.title ?? '',
        visit_time: item.lastVisitTime
            ? new Date(item.lastVisitTime).toISOString()
            : getUTCTimestamp(),
        visit_count: item.visitCount
    };

    return {
        event_id: generateUUID(),
        event_type: 'history_visit',
        timestamp: getUTCTimestamp(),
        browser: BROWSER,
        data
    };
}

/**
 * Fetch recent history and sync (for initial load or catch-up)
 */
export async function syncRecentHistory(maxResults: number = 100, daysBack: number = 7): Promise<number> {
    const startTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);

    try {
        const results = await chrome.history.search({
            text: '',
            maxResults,
            startTime
        });

        let count = 0;
        for (const item of results) {
            if (shouldTrackUrl(item.url)) {
                const event = createHistoryEvent(item);
                agentClient.queueEvent(event);
                count++;
            }
        }

        console.log(`[RAV] Synced ${count} history items from last ${daysBack} days`);
        return count;
    } catch (error) {
        console.error('[RAV] Failed to sync history:', error);
        return 0;
    }
}

// ============================================================================
// Download Collector
// ============================================================================

/**
 * Initialize download monitoring
 */
export function initDownloadCollector(): void {
    console.log('[RAV] Initializing download collector');

    // Listen for new downloads
    chrome.downloads.onCreated.addListener((downloadItem) => {
        const event = createDownloadEvent(downloadItem, 'download_started');
        agentClient.queueEvent(event);
    });

    // Listen for download state changes
    chrome.downloads.onChanged.addListener(async (delta) => {
        // Only interested in state changes
        if (!delta.state) return;

        try {
            // Get the full download item
            const [downloadItem] = await chrome.downloads.search({ id: delta.id });
            if (!downloadItem) return;

            let eventType: BrowserEvent['event_type'];

            switch (delta.state.current) {
                case 'complete':
                    eventType = 'download_completed';
                    break;
                case 'interrupted':
                    eventType = 'download_failed';
                    break;
                default:
                    return; // Ignore other states
            }

            const event = createDownloadEvent(downloadItem, eventType);
            agentClient.queueEvent(event);
        } catch (error) {
            console.error('[RAV] Error handling download change:', error);
        }
    });

    console.log('[RAV] Download collector initialized');
}

function createDownloadEvent(
    item: chrome.downloads.DownloadItem,
    eventType: 'download_started' | 'download_completed' | 'download_failed'
): BrowserEvent {
    const data: DownloadData = {
        download_id: item.id,
        filename: extractFilename(item.filename || item.finalUrl || 'unknown'),
        file_path: item.filename,
        source_url: item.finalUrl || item.url,
        referrer_url: item.referrer,
        file_size: item.totalBytes,
        mime_type: item.mime,
        state: mapDownloadState(item.state),
        start_time: item.startTime ? new Date(item.startTime).toISOString() : getUTCTimestamp(),
        end_time: item.endTime ? new Date(item.endTime).toISOString() : undefined,
        error: item.error
    };

    return {
        event_id: generateUUID(),
        event_type: eventType,
        timestamp: getUTCTimestamp(),
        browser: BROWSER,
        data
    };
}

function mapDownloadState(state: string): DownloadData['state'] {
    switch (state) {
        case 'in_progress':
            return 'in_progress';
        case 'complete':
            return 'complete';
        case 'interrupted':
            return 'interrupted';
        default:
            return 'cancelled';
    }
}

/**
 * Sync recent downloads (for initial load or catch-up)
 */
export async function syncRecentDownloads(maxResults: number = 50): Promise<number> {
    try {
        const results = await chrome.downloads.search({
            limit: maxResults,
            orderBy: ['-startTime']
        });

        let count = 0;
        for (const item of results) {
            const eventType = item.state === 'complete' ? 'download_completed' :
                item.state === 'interrupted' ? 'download_failed' :
                    'download_started';
            const event = createDownloadEvent(item, eventType);
            agentClient.queueEvent(event);
            count++;
        }

        console.log(`[RAV] Synced ${count} recent downloads`);
        return count;
    } catch (error) {
        console.error('[RAV] Failed to sync downloads:', error);
        return 0;
    }
}
