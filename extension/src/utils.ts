/**
 * RAV Browser Extension - Utility Functions
 */

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Get current UTC timestamp in ISO 8601 format
 */
export function getUTCTimestamp(): string {
    return new Date().toISOString();
}

/**
 * Convert Chrome timestamp (microseconds since 1601) to ISO string
 */
export function chromeTimeToISO(chromeTime: number): string {
    // Chrome uses microseconds since Jan 1, 1601
    // JavaScript uses milliseconds since Jan 1, 1970
    // Difference: 11644473600000 milliseconds
    const unixMs = chromeTime - 11644473600000;
    return new Date(unixMs).toISOString();
}

/**
 * Detect browser type
 */
export function detectBrowser(): string {
    const userAgent = navigator.userAgent.toLowerCase();

    if (userAgent.includes('edg/')) {
        return 'edge';
    } else if (userAgent.includes('chrome')) {
        return 'chrome';
    } else if (userAgent.includes('firefox')) {
        return 'firefox';
    } else if (userAgent.includes('safari')) {
        return 'safari';
    }

    return 'unknown';
}

/**
 * Check if a URL should be tracked (filter out internal browser URLs)
 */
export function shouldTrackUrl(url: string | undefined): boolean {
    if (!url) return false;

    // Skip browser internal pages
    const skipPatterns = [
        'chrome://',
        'chrome-extension://',
        'edge://',
        'about:',
        'moz-extension://',
        'file://',
        'data:',
        'blob:',
        'javascript:',
        'view-source:'
    ];

    for (const pattern of skipPatterns) {
        if (url.startsWith(pattern)) {
            return false;
        }
    }

    return true;
}

/**
 * Extract filename from a file path
 */
export function extractFilename(filePath: string): string {
    // Handle both Windows and Unix paths
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || filePath;
}

/**
 * Safely get a value with a default
 */
export function safeGet<T>(value: T | undefined | null, defaultValue: T): T {
    return value ?? defaultValue;
}
