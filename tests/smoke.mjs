// Smoke test: boots the game in headless Chromium at phone size and plays through the core loop.
// Run with a static server on :8080 (npm start), then: NODE_PATH=$(npm root -g) npm test
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright'); // honours NODE_PATH for a global install

const URL = process.env.GAME_URL || 'http://localhost:8080/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
// Software GL is slow: a phone-shaped viewport at 1x keeps the run short.
const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(URL);
await page.waitForFunction(() => window.__game);
await page.click('#mActs button');
const settle = () => page.waitForTimeout(1200);

// every part starts loose on the shelf at the back of the garage
assert.equal(await page.evaluate(() => __game.parts.filter((p) => p.state === 'loose').length), 32);
assert.ok(await page.evaluate(() => __game.parts.filter((p) => p.state === 'loose').every((p) => p.loose[2] < 12)));

// walls stop the player: hold "forward" into the back wall
await page.evaluate(() => { Object.assign(__game.player, { x: 45, z: 30, yaw: 0, pitch: 0 }); });
await page.keyboard.down('KeyW'); await page.waitForTimeout(4000); await page.keyboard.up('KeyW');
const pz = await page.evaluate(() => __game.player.z);
assert.ok(pz < 30 && pz > 13, `player should walk forward and stop at the bed, z=${pz}`);

// walk up to the shelf, tap the crankshaft to pick it up
await page.evaluate(() => { const g = __game; Object.assign(g.player, { x: g.byId.crank.loose[0], z: 17 }); g.lookAt(g.byId.crank.loose[0], g.byId.crank.loose[1] + 0.3, 4); });
await settle();
let pt = await page.evaluate(() => __game.screenOf(__game.byId.crank.group));
await page.mouse.click(pt.x, pt.y);
assert.equal(await page.evaluate(() => __game.state.held), 'crank');

// it comes off the shelf lying the wrong way up
assert.equal(await page.evaluate(() => __game.isOriented(__game.byId.crank)), false);

// carry it to the engine: the wrong way round, it will not go in
await page.evaluate(() => { const g = __game; Object.assign(g.player, { x: 10, z: 27, crouch: true }); g.lookAt(10, 9.6, 21.5); g.byId.crank.rot.copy(g.ORI.find((q) => Math.abs(q.y) > 0.7 && Math.abs(q.w) > 0.7)); });
await settle();
assert.equal(await page.locator('#stripAct').textContent(), 'Put down');
await page.evaluate(() => __game.tryFit());
assert.equal(await page.evaluate(() => __game.byId.crank.installed), false, 'a part turned the wrong way must not fit');

// quarter turns bring it round; then it drops in
for (let i = 0; i < 4 && !(await page.evaluate(() => __game.isOriented(__game.byId.crank))); i++) await page.click('#turnBtn');
assert.equal(await page.evaluate(() => __game.isOriented(__game.byId.crank)), true);
await page.waitForFunction(() => document.getElementById('stripAct').textContent === 'Drop in', null, { timeout: 20000 });
await page.click('#stripAct');
assert.equal(await page.evaluate(() => __game.byId.crank.installed), true);

// main cap bolt from underneath: wrong spanner, then the right one
// a bolted part can be picked up and fitted too
await page.evaluate(() => { const g = __game; g.hold(g.byId.maincap1); g.byId.maincap1.rot.identity(); });
await page.evaluate(() => { const g = __game; g.install(g.byId.maincap1); Object.assign(g.player, { x: 7.9, z: 25.2, crouch: true }); g.lookAt(7.85, 8.1, 21.8); });
await settle();
pt = await page.evaluate(() => __game.boltScreen(__game.byId.maincap1.bolts[1]));
await page.click('#tools button[data-tool="10"]');
await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
assert.equal(await page.evaluate(() => __game.byId.maincap1.bolts[1].tight), 0, 'wrong spanner must not turn the bolt');
await page.click('#tools button[data-tool="17"]');
await page.mouse.move(pt.x, pt.y); await page.mouse.down();
await page.waitForFunction(() => __game.byId.maincap1.bolts[1].tight === 1, null, { timeout: 60000 });
await page.mouse.up();

// survival: needs drain, taps and food refill them, bed advances the clock
await page.evaluate(() => { Object.assign(__game.stats, { energy: 30, hunger: 40, thirst: 40 }); });
await page.evaluate(() => __game.use('sink'));
await page.waitForTimeout(700);
await page.evaluate(() => __game.use('food'));
const st = await page.evaluate(() => ({ ...__game.stats }));
assert.ok(st.thirst > 60 && st.hunger > 70, JSON.stringify(st));
await page.waitForTimeout(700);
const before = await page.evaluate(() => __game.time.day + __game.time.t);
await page.evaluate(() => __game.use('bed'));
await page.waitForFunction(() => !__game.state.busy && __game.stats.energy > 90, null, { timeout: 30000 });
assert.ok((await page.evaluate(() => __game.time.day + __game.time.t)) - before > 0.2, 'sleeping passes hours');

// diagnosis catches mistakes, and a complete build runs
await page.evaluate(() => __game.buildAll(true));
assert.deepEqual(await page.evaluate(() => __game.diagnose()), { fail: null, loud: false });
await page.evaluate(() => { __game.byId.oilpan.bolts[3].tight = 0; });
assert.ok((await page.evaluate(() => __game.diagnose())).fail.leak);
await page.evaluate(() => { const g = __game; g.buildAll(true); Object.assign(g.player, { x: 22, z: 34, crouch: false }); g.lookAt(10, 9, 21.5); });
await page.click('#startBtn');
await page.waitForFunction(() => __game.state.won, null, { timeout: 90000 });
await page.screenshot({ path: process.env.SHOT || 'tests/running.png' });

assert.deepEqual(errors, []);
await browser.close();
console.log('smoke test passed');
