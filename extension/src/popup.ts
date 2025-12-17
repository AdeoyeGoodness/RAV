/**
 * RAV Browser Extension - Popup Script
 */

document.addEventListener('DOMContentLoaded', () => {
    const statusDot = document.getElementById('statusDot')!;
    const connectionStatus = document.getElementById('connectionStatus')!;
    const queueSize = document.getElementById('queueSize')!;
    const lastSync = document.getElementById('lastSync')!;
    const syncBtn = document.getElementById('syncBtn') as HTMLButtonElement;
    const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;

    // Update status display
    function updateStatus() {
        chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Error getting status:', chrome.runtime.lastError);
                connectionStatus.textContent = 'Error';
                statusDot.className = 'status-dot disconnected';
                return;
            }

            // Update connection status
            if (response.isConnected) {
                statusDot.className = 'status-dot connected';
                connectionStatus.textContent = 'Connected';
            } else {
                statusDot.className = 'status-dot disconnected';
                connectionStatus.textContent = 'Disconnected';
            }

            // Update queue size
            queueSize.textContent = response.queueSize.toString();

            // Update last sync time
            if (response.lastSyncTime) {
                const date = new Date(response.lastSyncTime);
                const now = Date.now();
                const diff = Math.floor((now - response.lastSyncTime) / 1000);

                if (diff < 60) {
                    lastSync.textContent = `${diff}s ago`;
                } else if (diff < 3600) {
                    lastSync.textContent = `${Math.floor(diff / 60)}m ago`;
                } else {
                    lastSync.textContent = date.toLocaleTimeString();
                }
            } else {
                lastSync.textContent = 'Never';
            }
        });
    }

    // Sync button handler
    syncBtn.addEventListener('click', () => {
        syncBtn.disabled = true;
        syncBtn.textContent = 'Syncing...';

        chrome.runtime.sendMessage({ type: 'FORCE_SYNC' }, (response) => {
            syncBtn.disabled = false;
            syncBtn.textContent = 'Sync Now';

            if (response?.success) {
                updateStatus();
            }
        });
    });

    // Clear button handler
    clearBtn.addEventListener('click', () => {
        if (confirm('Clear all pending events?')) {
            chrome.runtime.sendMessage({ type: 'CLEAR_QUEUE' }, () => {
                updateStatus();
            });
        }
    });

    // Initial status update
    updateStatus();

    // Refresh every 2 seconds
    setInterval(updateStatus, 2000);
});
