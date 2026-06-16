/**
 * Dev utility: capture the README screenshots from a running dashboard.
 *
 *   1. Start the app:        npm start
 *   2. Install a browser:    npx playwright install chromium
 *   3. Capture:              node screenshot.cjs
 *
 * Override the target with BASE_URL (default http://localhost:3000).
 * Requires playwright to be available (locally or globally).
 */
const path = require('node:path');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    // Fall back to a global install if not a local dependency.
    const { execSync } = require('node:child_process');
    const root = execSync('npm root -g').toString().trim();
    return require(path.join(root, 'playwright'));
  }
}

const { chromium } = loadPlaywright();
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, 'docs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.machine-item');
  await page.click('.machine-item');
  await page.waitForTimeout(2500); // let charts + WebSocket paint

  await page.screenshot({ path: path.join(OUT, 'dashboard.png'), fullPage: true });
  console.log('captured dashboard.png');

  // Add Machine dialog showing the Allen Bradley tag mapping.
  await page.click('#btn-add-machine');
  await page.waitForSelector('#f-type');
  await page.selectOption('#f-type', 'allen-bradley');
  await page.waitForSelector('.tag-section');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'add-machine-ab.png') });
  console.log('captured add-machine-ab.png');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
