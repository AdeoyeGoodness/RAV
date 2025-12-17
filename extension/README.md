/**
 * RAV Browser Extension - README
 * 
 * Secure browser activity monitoring extension for the RAV platform.
 */

# RAV Browser Extension

A Manifest V3 browser extension that securely collects browser activity and sends it to the local RAV agent.

## What's Collected

| Data Type | Description | API Used |
|-----------|-------------|----------|
| **Active Tab** | Currently focused tab URL and title | `tabs.onActivated`, `tabs.onUpdated` |
| **History** | Visited URLs with timestamps | `history.onVisited`, `history.search` |
| **Downloads** | Downloaded files with metadata | `downloads.onCreated`, `downloads.onChanged` |

## What's NOT Collected

- ❌ Passwords
- ❌ Cookies  
- ❌ Form data
- ❌ Page content/DOM
- ❌ Keystrokes

## Security Model

```
Extension ↔ Agent: Local only (127.0.0.1:8089)
Agent ↔ Server: Secure, authenticated, batched
```

- No direct browser-to-server connections
- No listening ports exposed to network
- All communication stays on localhost

## Building

```bash
# Install dependencies
npm install

# Build extension
npm run build

# Output will be in ./dist folder
```

## Loading in Browser

### Chrome/Edge

1. Go to `chrome://extensions` or `edge://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist` folder

### Firefox

1. Go to `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select `dist/manifest.json`

## Development

```bash
# Watch for changes
npm run watch

# In another terminal, run copy-assets when needed
npm run copy-assets
```

## Configuration

The extension connects to the RAV agent at `http://127.0.0.1:8089/api/extension/events`.

To change this:
1. Edit `src/types.ts` → `DEFAULT_CONFIG.agent_url`
2. Rebuild the extension

## Project Structure

```
extension/
├── manifest.json       # Extension manifest (MV3)
├── package.json        # Dependencies
├── tsconfig.json       # TypeScript config
├── scripts/
│   └── copy-assets.js  # Build helper
├── src/
│   ├── background.ts   # Service worker (main entry)
│   ├── collectors.ts   # Event collection logic
│   ├── agent-client.ts # Agent communication
│   ├── types.ts        # TypeScript types
│   ├── utils.ts        # Helper functions
│   ├── popup.html      # Extension popup UI
│   └── popup.ts        # Popup JavaScript
└── dist/               # Built extension (load this)
```

## Troubleshooting

### Extension shows "Disconnected"

1. Make sure the RAV agent is running
2. Check that the agent's extension server is enabled
3. Verify no firewall is blocking localhost:8089

### No events being collected

1. Check the browser console (right-click extension icon → Inspect)
2. Verify permissions are granted
3. Check if the page URL is being filtered (internal pages are skipped)

## License

Part of the RAV Enterprise Digital Forensics Platform.
