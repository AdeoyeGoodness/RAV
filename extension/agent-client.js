/**
 * RAV Browser Extension - Agent Communication
 *
 * Handles secure communication with the local RAV agent.
 * All communication uses Chrome Native Messaging (stdio protocol).
 */
import { DEFAULT_CONFIG } from './types.js';
const EXTENSION_VERSION = '1.0.0';
/**
 * AgentClient handles communication with the local RAV agent
 */
export class AgentClient {
    constructor(config = {}) {
        this.eventQueue = [];
        this.isConnected = false;
        this.lastSyncTime = 0;
        this.syncInProgress = false;
        this.syncDebounceTimer = null;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Add an event to the queue for batching
     */
    queueEvent(event) {
        this.eventQueue.push(event);
        console.log('[RAV] Queued event:', event.event_type, event);
        // Force sync if batch size reached
        if (this.eventQueue.length >= this.config.max_batch_size) {
            this.sync();
        }
        else {
            // Auto-sync after a short debounce (2 seconds)
            // This groups rapid events together but still syncs quickly
            this.scheduleDebouncedSync();
        }
    }
    /**
     * Schedule a debounced sync (groups rapid events together)
     */
    scheduleDebouncedSync() {
        if (this.syncDebounceTimer) {
            clearTimeout(this.syncDebounceTimer);
        }
        this.syncDebounceTimer = setTimeout(() => {
            this.syncDebounceTimer = null;
            this.sync();
        }, 2000); // 2 second debounce
    }
    /**
     * Get the number of queued events
     */
    getQueueSize() {
        return this.eventQueue.length;
    }
    /**
     * Check if agent is connected
     */
    getConnectionStatus() {
        return this.isConnected;
    }
    /**
     * Sync queued events with the agent
     */
    async sync() {
        if (this.syncInProgress) {
            console.log('[RAV] Sync already in progress, skipping');
            return false;
        }
        if (this.eventQueue.length === 0) {
            console.log('[RAV] No events to sync');
            return true;
        }
        this.syncInProgress = true;
        try {
            // Take events from queue
            const eventsToSync = [...this.eventQueue];
            const payload = {
                events: eventsToSync,
                extension_version: EXTENSION_VERSION,
                batch_timestamp: new Date().toISOString()
            };
            console.log(`[RAV] Syncing ${eventsToSync.length} events to agent...`);
            const response = await this.sendToAgent(payload);
            if (response.success) {
                // Remove synced events from queue
                this.eventQueue = this.eventQueue.slice(eventsToSync.length);
                this.isConnected = true;
                this.lastSyncTime = Date.now();
                console.log(`[RAV] Successfully synced ${response.events_processed} events`);
                return true;
            }
            else {
                console.error('[RAV] Agent returned error:', response.error);
                this.isConnected = false;
                return false;
            }
        }
        catch (error) {
            console.error('[RAV] Failed to sync with agent:', error);
            this.isConnected = false;
            return false;
        }
        finally {
            this.syncInProgress = false;
        }
    }
    /**
     * Send payload to the local agent via Native Messaging
     */
    async sendToAgent(payload) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Connection timeout - agent may not be running'));
            }, 5000); // 5 second timeout
            try {
                chrome.runtime.sendNativeMessage('com.rav.agent', payload, (response) => {
                    clearTimeout(timeoutId);
                    // Check for native messaging errors
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!response) {
                        reject(new Error('No response from native host'));
                        return;
                    }
                    resolve(response);
                });
            }
            catch (error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        });
    }
    /**
     * Check if agent is reachable via Native Messaging
     */
    async ping() {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendNativeMessage('com.rav.agent', { type: 'ping' }, (response) => {
                    if (chrome.runtime.lastError) {
                        this.isConnected = false;
                        resolve(false);
                        return;
                    }
                    this.isConnected = response && response.status === 'ok';
                    resolve(this.isConnected);
                });
            }
            catch {
                this.isConnected = false;
                resolve(false);
            }
        });
    }
    /**
     * Get sync statistics
     */
    getStats() {
        return {
            queueSize: this.eventQueue.length,
            isConnected: this.isConnected,
            lastSyncTime: this.lastSyncTime
        };
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * Persist queue to storage (for service worker restarts)
     */
    async persistQueue() {
        await chrome.storage.local.set({
            eventQueue: this.eventQueue,
            lastSyncTime: this.lastSyncTime
        });
    }
    /**
     * Restore queue from storage
     */
    async restoreQueue() {
        const data = await chrome.storage.local.get(['eventQueue', 'lastSyncTime']);
        if (data.eventQueue && Array.isArray(data.eventQueue)) {
            this.eventQueue = data.eventQueue;
            console.log(`[RAV] Restored ${this.eventQueue.length} events from storage`);
        }
        if (data.lastSyncTime) {
            this.lastSyncTime = data.lastSyncTime;
        }
    }
    /**
     * Clear all queued events
     */
    clearQueue() {
        this.eventQueue = [];
        chrome.storage.local.remove(['eventQueue']);
    }
}
// Export singleton instance
export const agentClient = new AgentClient();
//# sourceMappingURL=agent-client.js.map