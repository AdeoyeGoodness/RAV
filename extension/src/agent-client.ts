/**
 * RAV Browser Extension - Agent Communication
 * 
 * Handles secure communication with the local RAV agent.
 * All communication is localhost-only (127.0.0.1).
 */

import { AgentPayload, AgentResponse, BrowserEvent, ExtensionConfig, DEFAULT_CONFIG } from './types.js';

const EXTENSION_VERSION = '1.0.0';

/**
 * AgentClient handles communication with the local RAV agent
 */
export class AgentClient {
    private config: ExtensionConfig;
    private eventQueue: BrowserEvent[] = [];
    private isConnected: boolean = false;
    private lastSyncTime: number = 0;
    private syncInProgress: boolean = false;
    private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(config: Partial<ExtensionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Add an event to the queue for batching
     */
    queueEvent(event: BrowserEvent): void {
        this.eventQueue.push(event);
        console.log(`[RAV] Queued event: ${event.event_type}`, event);

        // Force sync if batch size reached
        if (this.eventQueue.length >= this.config.max_batch_size) {
            this.sync();
        } else {
            // Auto-sync after a short debounce (2 seconds)
            // This groups rapid events together but still syncs quickly
            this.scheduleDebouncedSync();
        }
    }

    /**
     * Schedule a debounced sync (groups rapid events together)
     */
    private scheduleDebouncedSync(): void {
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
    getQueueSize(): number {
        return this.eventQueue.length;
    }

    /**
     * Check if agent is connected
     */
    getConnectionStatus(): boolean {
        return this.isConnected;
    }

    /**
     * Sync queued events with the agent
     */
    async sync(): Promise<boolean> {
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

            const payload: AgentPayload = {
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
            } else {
                console.error('[RAV] Agent returned error:', response.error);
                this.isConnected = false;
                return false;
            }
        } catch (error) {
            console.error('[RAV] Failed to sync with agent:', error);
            this.isConnected = false;
            return false;
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Send payload to the local agent
     */
    private async sendToAgent(payload: AgentPayload): Promise<AgentResponse> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        try {
            const response = await fetch(this.config.agent_url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-RAV-Extension': EXTENSION_VERSION
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json() as AgentResponse;
        } catch (error) {
            clearTimeout(timeoutId);

            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('Connection timeout - agent may not be running');
            }

            throw error;
        }
    }

    /**
     * Check if agent is reachable
     */
    async ping(): Promise<boolean> {
        try {
            const response = await fetch(this.config.agent_url.replace('/events', '/ping'), {
                method: 'GET',
                headers: {
                    'X-RAV-Extension': EXTENSION_VERSION
                }
            });

            this.isConnected = response.ok;
            return response.ok;
        } catch {
            this.isConnected = false;
            return false;
        }
    }

    /**
     * Get sync statistics
     */
    getStats(): { queueSize: number; isConnected: boolean; lastSyncTime: number } {
        return {
            queueSize: this.eventQueue.length,
            isConnected: this.isConnected,
            lastSyncTime: this.lastSyncTime
        };
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<ExtensionConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Persist queue to storage (for service worker restarts)
     */
    async persistQueue(): Promise<void> {
        await chrome.storage.local.set({
            eventQueue: this.eventQueue,
            lastSyncTime: this.lastSyncTime
        });
    }

    /**
     * Restore queue from storage
     */
    async restoreQueue(): Promise<void> {
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
    clearQueue(): void {
        this.eventQueue = [];
        chrome.storage.local.remove(['eventQueue']);
    }
}

// Export singleton instance
export const agentClient = new AgentClient();
