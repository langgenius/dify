const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [
  { size: 192, name: 'icon-192x192.png' },
  { size: 256, name: 'icon-256x256.png' },
  { size: 384, name: 'icon-384x384.png' },
  { size: 512, name: 'icon-512x512.png' },
  { size: 96, name: 'icon-96x96.png' },
  { size: 72, name: 'icon-72x72.png' },
  { size: 128, name: 'icon-128x128.png' },
  { size: 144, name: 'icon-144x144.png' },
  { size: 152, name: 'icon-152x152.png' },
];

const inputPath = path.join(__dirname, '../public/icon.svg');
const outputDir = path.join(__dirname, '../public');

// Generate icons
async function generateIcons() {
  try {
    console.log('Generating PWA icons...');
    
    for (const { size, name } of sizes) {
      const outputPath = path.join(outputDir, name);
      
      await sharp(inputPath)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Generated ${name} (${size}x${size})`);
    }
    
    // Generate apple-touch-icon
    await sharp(inputPath)
      .resize(180, 180)
      .png()
      .toFile(path.join(outputDir, 'apple-touch-icon.png'));
    
    console.log('✓ Generated apple-touch-icon.png (180x180)');
    
    console.log('\n✅ All icons generated successfully!');
  } catch (error) {
    console.error('Error generating icons:', error);
    process.exit(1);
  }
}

generateIcons();