/**
 * Génère les icônes PNG (PWA, Apple, Android) à partir de public/icon.svg
 * en utilisant Chromium via Playwright.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const svg = readFileSync('public/icon.svg', 'utf8');
const maskable = readFileSync('public/icon-maskable.svg', 'utf8');
const targets = [
  ['public/icons/icon-192.png', svg, 192],
  ['public/icons/icon-512.png', svg, 512],
  ['public/icons/apple-touch-icon.png', maskable, 180],
  ['public/icons/maskable-512.png', maskable, 512],
  ['public/icons/favicon-48.png', svg, 48],
];
const android = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(content, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${content.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
for (const [out, content, size] of targets) {
  writeFileSync(out, await render(content, size));
  console.log('✓', out);
}
// Ressources Android (si le projet Capacitor existe).
if (existsSync('android/app/src/main/res')) try {
  for (const [dpi, launcher, fg] of android) {
    const dir = `android/app/src/main/res/mipmap-${dpi}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/ic_launcher.png`, await render(svg, launcher));
    writeFileSync(`${dir}/ic_launcher_round.png`, await render(svg.replace('rx="112"', 'rx="256"').replace('rx="112"', 'rx="256"'), launcher));
    writeFileSync(`${dir}/ic_launcher_foreground.png`, await render(maskable.replace(/<rect width="512" height="512" fill="url\(#bg\)"\/>/, '').replace(/<rect width="512" height="512" fill="url\(#shine\)"\/>/, ''), fg));
  }
  // Écrans de démarrage : fond nuit, icône centrée, aux dimensions d'origine.
  const res = 'android/app/src/main/res';
  for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
    const file = `${res}/${dir}/splash.png`;
    if (!existsSync(file)) continue;
    const buf = readFileSync(file);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    const size = Math.round(Math.min(w, h) * 0.28);
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%, #12302a, #0a0f14 60%)">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    writeFileSync(file, await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }));
  }
  writeFileSync(`${res}/values/ic_launcher_background.xml`, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#149A77</color>\n</resources>\n');
  console.log('✓ ressources Android (icônes adaptatives, écrans de démarrage)');
} catch (e) {
  console.log('Ressources Android ignorées :', e.message);
}
await browser.close();
