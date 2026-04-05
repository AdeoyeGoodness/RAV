/**
 * RAV Browser Extension - Background Service Worker
 *
 * Main entry point for the extension. Initializes collectors
 * and manages the sync loop with the local RAV agent.
 */
import { agentClient } from './agent-client.js';
import { initActiveTabCollector, initHistoryCollector, initDownloadCollector, syncRecentHistory, syncRecentDownloads } from './collectors.js';
import { DEFAULT_CONFIG } from './types.js';
// ============================================================================
// Constants
// ============================================================================
const SYNC_ALARM_NAME = 'rav-sync-alarm';
const PING_ALARM_NAME = 'rav-ping-alarm';
// ============================================================================
// Initialization
// ============================================================================
/**
 * Initialize the extension
 */
async function initialize() {
    console.log('[RAV] Initializing RAV Browser Extension...');
    // Restore any persisted events from previous session
    await agentClient.restoreQueue();
    // Initialize event collectors
    initActiveTabCollector();
    initHistoryCollector();
    initDownloadCollector();
    // Set up periodic sync alarm
    await setupAlarms();
    // Check agent connection
    const isConnected = await agentClient.ping();
    console.log(`[RAV] Agent connection: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
    // If connected, do an initial sync of recent data
    if (isConnected) {
        await performInitialSync();
    }
    console.log('[RAV] Extension initialized successfully');
}
/**
 * Perform initial sync of recent history and downloads
 */
async function performInitialSync() {
    console.log('[RAV] Performing initial sync...');
    // Check if we've done initial sync before
    const data = await chrome.storage.local.get(['initialSyncDone']);
    if (data.initialSyncDone) {
        console.log('[RAV] Initial sync already completed, skipping');
        return;
    }
    // Sync recent history (last 7 days, max 10000 items)
    await syncRecentHistory(10000, DEFAULT_CONFIG.max_history_age_days);
    // Sync recent downloads (all items)
    await syncRecentDownloads(0);
    // Sync to agent
    await agentClient.sync();
    // Mark initial sync as done
    await chrome.storage.local.set({ initialSyncDone: true });
    console.log('[RAV] Initial sync completed');
}
/**
 * Set up periodic alarms for syncing and health checks
 */
async function setupAlarms() {
    // Clear existing alarms first
    await chrome.alarms.clearAll();
    // Sync alarm - runs every 30 seconds
    chrome.alarms.create(SYNC_ALARM_NAME, {
        delayInMinutes: 0.5, // First run in 30 seconds
        periodInMinutes: 0.5 // Then every 30 seconds
    });
    // Ping alarm - check agent connection every 2 minutes
    chrome.alarms.create(PING_ALARM_NAME, {
        delayInMinutes: 2,
        periodInMinutes: 2
    });
    console.log('[RAV] Alarms configured');
}
// ============================================================================
// Alarm Handler
// ============================================================================
chrome.alarms.onAlarm.addListener(async (alarm) => {
    console.log(`[RAV] Alarm triggered: ${alarm.name}`);
    switch (alarm.name) {
        case SYNC_ALARM_NAME:
            await handleSyncAlarm();
            break;
        case PING_ALARM_NAME:
            await handlePingAlarm();
            break;
    }
});
async function handleSyncAlarm() {
    const stats = agentClient.getStats();
    console.log(`[RAV] Sync alarm - Queue size: ${stats.queueSize}, Connected: ${stats.isConnected}`);
    if (stats.queueSize > 0) {
        const success = await agentClient.sync();
        if (success) {
            // Persist queue state after successful sync
            await agentClient.persistQueue();
        }
    }
}
async function handlePingAlarm() {
    const isConnected = await agentClient.ping();
    console.log(`[RAV] Ping alarm - Agent status: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
    // Update badge to show connection status
    updateBadge(isConnected);
}
// ============================================================================
// Badge UI
// ============================================================================
function updateBadge(isConnected) {
    if (isConnected) {
        chrome.action.setBadgeText({ text: '' });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    }
    else {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#F44336' });
    }
}
// ============================================================================
// Message Handler (for popup communication)
// ============================================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log('[RAV] Received message:', message);
    switch (message.type) {
        case 'GET_STATUS':
            const stats = agentClient.getStats();
            sendResponse({
                queueSize: stats.queueSize,
                isConnected: stats.isConnected,
                lastSyncTime: stats.lastSyncTime
            });
            break;
        case 'FORCE_SYNC':
            agentClient.sync().then((success) => {
                sendResponse({ success });
            });
            return true; // Keep channel open for async response
        case 'CLEAR_QUEUE':
            agentClient.clearQueue();
            sendResponse({ success: true });
            break;
        case 'RESET_INITIAL_SYNC':
            chrome.storage.local.remove(['initialSyncDone']).then(() => {
                sendResponse({ success: true });
            });
            return true;
        default:
            sendResponse({ error: 'Unknown message type' });
    }
    return false;
});
// ============================================================================
// Lifecycle Events
// ============================================================================
// Handle service worker startup
chrome.runtime.onStartup.addListener(() => {
    console.log('[RAV] Browser started');
    initialize();
});
// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
    console.log(`[RAV] Extension ${details.reason}`);
    if (details.reason === 'install') {
        // Fresh install - will do initial sync
        chrome.storage.local.remove(['initialSyncDone', 'eventQueue']);
    }
    initialize();
});
// Handle suspend (service worker going to sleep)
chrome.runtime.onSuspend.addListener(() => {
    console.log('[RAV] Service worker suspending, persisting queue...');
    agentClient.persistQueue();
});
// Initialize on script load (for cases where other events don't fire)
initialize();
//# sourceMappingURL=background.js.map