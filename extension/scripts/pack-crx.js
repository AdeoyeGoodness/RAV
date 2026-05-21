/**
 * Pack the built extension (dist/) into a signed CRX3 using our fixed signing key,
 * so the extension ID is stable and matches the force-install policy + native-messaging
 * allowed_origins. Output is consumed by the backend (served at /api/v1/extension/download).
 *
 *   node scripts/pack-crx.js
 *
 * Key path / output can be overridden via RAV_CRX_KEY / RAV_CRX_OUT env vars.
 */
const path = require('path');
const fs = require('fs');
const crx3 = require('crx3');

const root = path.join(__dirname, '..');
const manifest = path.join(root, 'dist', 'manifest.json');
const keyPath = process.env.RAV_CRX_KEY || path.join(root, '..', 'agent-wix', 'rav-extension.pem');
const crxPath = process.env.RAV_CRX_OUT || path.join(root, '..', 'agent-wix', 'output', 'rav.crx');

if (!fs.existsSync(manifest)) {
    console.error(`pack-crx: ${manifest} not found — run "npm run build" first.`);
    process.exit(1);
}
if (!fs.existsSync(keyPath)) {
    console.error(`pack-crx: signing key not found at ${keyPath}`);
    process.exit(1);
}
fs.mkdirSync(path.dirname(crxPath), { recursive: true });

crx3([manifest], { keyPath, crxPath })
    .then(() => console.log(`pack-crx: CRX written -> ${crxPath}`))
    .catch((e) => { console.error('pack-crx: failed:', e); process.exit(1); });
