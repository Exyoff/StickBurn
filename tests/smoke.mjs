// Smoke test: boots the game in headless Chromium at phone size and plays through the core loop
// using only the on-screen controls (crosshair, buttons) plus the keyboard for walking.
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
const targetIs = (kind, id) => page.waitForFunction(([k, i]) => { const t = __game.state.target; return t && t.kind === k && t.id === i; }, [kind, id], { timeout: 30000 });
const label = () => page.locator('#actBtn').textContent();
const holdButton = async (sel, until) => {
  const box = await page.locator(sel).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  if (typeof until === 'number') await page.waitForTimeout(until); else await page.waitForFunction(until, null, { timeout: 60000 });
  await page.mouse.up();
};

// every model is sound: finite, no zero-area triangles, solids closed and facing outwards
const audit = await page.evaluate(() => __game.audit());
assert.deepEqual(audit.bad, [], 'mesh audit');
assert.ok(audit.meshes > 200 && audit.tris > 50000);

// every part starts loose on the shelf at the back of the garage
assert.equal(await page.evaluate(() => __game.parts.filter((p) => p.state === 'loose').length), 34);
assert.ok(await page.evaluate(() => __game.parts.filter((p) => p.state === 'loose').every((p) => p.loose[2] < 12)));
// spark plugs and belts go on any way round; other parts have to be turned
assert.ok(await page.evaluate(() => ['plug1', 'plug4', 'belt', 'chain'].every((id) => __game.isOriented(__game.byId[id]))));
assert.equal(await page.evaluate(() => __game.isOriented(__game.byId.crank)), false);

// walls stop the player: hold "forward" towards the bed
await page.evaluate(() => { Object.assign(__game.player, { x: 45, z: 30, yaw: 0, pitch: 0 }); });
await page.keyboard.down('KeyW'); await page.waitForTimeout(4000); await page.keyboard.up('KeyW');
const pz = await page.evaluate(() => __game.player.z);
assert.ok(pz < 30 && pz > 13, `player should walk forward and stop at the bed, z=${pz}`);

// the look stick turns the view
const yaw0 = await page.evaluate(() => __game.player.yaw);
const ls = await page.locator('#look').boundingBox();
await page.mouse.move(ls.x + ls.width / 2, ls.y + ls.height / 2); await page.mouse.down();
await page.mouse.move(ls.x + ls.width - 4, ls.y + ls.height / 2); await page.waitForTimeout(1500); await page.mouse.up();
assert.ok((await page.evaluate(() => __game.player.yaw)) < yaw0 - 0.2, 'look stick turns right');

// walk up to the shelf, put the crosshair on the crankshaft, Grab
await page.evaluate(() => { const g = __game, c = g.centreOf(g.byId.crank.group); Object.assign(g.player, { x: c[0], z: 17, crouch: false }); g.lookAt(...c); });
await targetIs('loose', 'crank');
assert.equal(await label(), 'Grab');
await page.click('#actBtn');
assert.equal(await page.evaluate(() => __game.state.held), 'crank');

// carry it to the engine: the wrong way round it will not go in
await page.evaluate(() => { const g = __game; Object.assign(g.player, { x: 10, z: 27, crouch: true }); g.lookAt(10, 9.6, 21.5); g.byId.crank.rot.copy(g.ORI.find((q) => Math.abs(q.y) > 0.7 && Math.abs(q.w) > 0.7)); });
await page.waitForFunction(() => document.getElementById('aim').textContent.includes('Wrong way round'), null, { timeout: 30000 });
assert.equal(await label(), 'Put down');
for (let i = 0; i < 4 && !(await page.evaluate(() => __game.isOriented(__game.byId.crank))); i++) await page.click('#turnBtn');
await page.waitForFunction(() => document.getElementById('actBtn').textContent === 'Drop in', null, { timeout: 30000 });
await page.click('#actBtn');
assert.equal(await page.evaluate(() => __game.byId.crank.installed), true);

// a main cap bolt from underneath: wrong spanner, then the right one
await page.evaluate(() => {
  const g = __game, p = g.byId.maincap1, b = p.bolts[1];
  g.hold(p); p.rot.identity(); g.install(p);
  const w = b.head.getWorldPosition(g.camera.position.clone());
  Object.assign(g.player, { x: w.x, z: w.z + 3.4, crouch: true });
  g.lookAt(w.x, w.y, w.z);
});
await targetIs('bolt', 'maincap1');
await page.click('#tools button[data-tool="10"]');
await holdButton('#tightBtn', 600);
assert.equal(await page.evaluate(() => __game.byId.maincap1.bolts[1].tight), 0, 'wrong spanner must not turn the bolt');
await page.click('#tools button[data-tool="17"]');
await holdButton('#tightBtn', () => __game.byId.maincap1.bolts[1].tight === 1);
assert.match(await page.locator('#aim').textContent(), /1\/2 tight · 17 mm/);

// a bolted part will not come off; undo the bolt and it does
assert.equal(await label(), 'Take off');
await page.click('#actBtn');
assert.equal(await page.evaluate(() => __game.byId.maincap1.installed), true);
await holdButton('#looseBtn', () => __game.byId.maincap1.bolts[1].tight === 0);
await page.click('#actBtn');
assert.equal(await page.evaluate(() => __game.state.held), 'maincap1');

// finishing the engine is noticed
await page.evaluate(() => __game.buildAll(true));
assert.equal(await page.locator('#sBolts').textContent(), '91/91');
assert.equal(await page.evaluate(() => __game.state.done), true);
await page.screenshot({ path: process.env.SHOT || 'tests/running.png' });

assert.deepEqual(errors, []);
await browser.close();
console.log('smoke test passed');
