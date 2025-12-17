/**
 * Copy static assets to dist folder
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..');
const distDir = path.join(__dirname, '..', 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Files to copy
const filesToCopy = [
    'manifest.json',
    'src/popup.html'
];

// Copy files
filesToCopy.forEach(file => {
    const src = path.join(srcDir, file);
    const destFileName = file.includes('/') ? path.basename(file) : file;
    const dest = path.join(distDir, destFileName);

    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Copied: ${file} -> dist/${destFileName}`);
    } else {
        console.warn(`Warning: ${file} not found`);
    }
});

// Create icons directory
const iconsDir = path.join(distDir, 'icons');
if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate placeholder icons (simple colored squares)
const iconSizes = [16, 48, 128];
iconSizes.forEach(size => {
    const iconPath = path.join(iconsDir, `icon${size}.png`);
    // Create a simple 1x1 pixel PNG as placeholder
    // In production, replace with actual icons
    if (!fs.existsSync(iconPath)) {
        // Create minimal PNG header for a colored pixel
        const png = Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            0x00, 0x00, 0x00, 0x0D, // IHDR length
            0x49, 0x48, 0x44, 0x52, // IHDR
            0x00, 0x00, 0x00, 0x01, // width = 1
            0x00, 0x00, 0x00, 0x01, // height = 1
            0x08, 0x02, // bit depth = 8, color type = RGB
            0x00, 0x00, 0x00, // compression, filter, interlace
            0x90, 0x77, 0x53, 0xDE, // IHDR CRC
            0x00, 0x00, 0x00, 0x0C, // IDAT length
            0x49, 0x44, 0x41, 0x54, // IDAT
            0x08, 0xD7, 0x63, 0x60, 0x60, 0xF8, 0x0F, 0x00, // compressed data (purple-ish)
            0x01, 0x01, 0x01, 0x00,
            0x18, 0xDD, 0x8D, 0xB4, // IDAT CRC
            0x00, 0x00, 0x00, 0x00, // IEND length
            0x49, 0x45, 0x4E, 0x44, // IEND
            0xAE, 0x42, 0x60, 0x82  // IEND CRC
        ]);
        fs.writeFileSync(iconPath, png);
        console.log(`Created placeholder: icons/icon${size}.png`);
    }
});

console.log('Assets copied successfully!');
