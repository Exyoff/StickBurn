// Smoke test: boots the game in headless Chromium at phone size and plays through the core loop.
// Run with a static server on :8080 (npm start), then: npm test
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright'); // honours NODE_PATH for a global install
import assert from 'node:assert/strict';

const URL = process.env.GAME_URL || 'http://localhost:8080/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
// Software GL is slow: phone-shaped viewport at 1x keeps the run short.
const page = await browser.newPage({ ...devices['Pixel 7'], viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(URL);
await page.waitForFunction(() => window.__game);
await page.click('#mActs button');

// shelf -> ghost -> install
await page.click('#partsBtn');
assert.equal(await page.locator('#grid .card').count(), 32);
await page.click('#grid .card >> text=Crankshaft');
assert.equal(await page.evaluate(() => __game.state.held), 'crank');
await page.evaluate(() => __game.install(__game.byId.crank));
await page.evaluate(() => __game.install(__game.byId.maincap1));

// look from underneath, find a main cap bolt, wrong size then right size
await page.evaluate(() => { __game.cam.goal.set(-2.15, -0.3, 0); __game.cam.ph = 2.3; __game.cam.th = 0.3; __game.cam.r = __game.cam.rGoal = 6; });
await page.waitForFunction(() => Math.abs(__game.cam.r - __game.cam.rGoal) < 0.01 && __game.cam.target.distanceTo(__game.cam.goal) < 0.01, null, { timeout: 30000 });
await page.waitForTimeout(300);
const pt = await page.evaluate(() => __game.boltScreen(__game.byId.maincap1.bolts[0]));
await page.click('#tools button[data-tool="10"]');
await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
assert.equal(await page.evaluate(() => __game.byId.maincap1.bolts[0].tight), 0, 'wrong spanner must not turn the bolt');
await page.click('#tools button[data-tool="17"]');
await page.mouse.move(pt.x, pt.y); await page.mouse.down();
await page.waitForFunction(() => __game.byId.maincap1.bolts[0].tight === 1, null, { timeout: 60000 });
await page.mouse.up();
assert.equal(await page.evaluate(() => __game.byId.maincap1.bolts[0].tight), 1, 'right spanner tightens the bolt');

// diagnosis catches mistakes, and a complete build runs
await page.evaluate(() => __game.buildAll(true));
assert.deepEqual(await page.evaluate(() => __game.diagnose()), { fail: null, loud: false });
await page.evaluate(() => { __game.byId.oilpan.bolts[3].inner.position.y = 0.2; __game.byId.oilpan.bolts[3].tight = 0; });
assert.ok((await page.evaluate(() => __game.diagnose())).fail.leak);
await page.evaluate(() => __game.buildAll(true));
await page.click('#startBtn');
await page.waitForFunction(() => __game.state.won, null, { timeout: 90000 });
await page.screenshot({ path: process.env.SHOT || 'tests/running.png' });

assert.deepEqual(errors, []);
await browser.close();
console.log('smoke test passed');
