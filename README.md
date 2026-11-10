# Bolt by Bolt

A mobile web game: build a four-cylinder engine in 3D, one bolt at a time.

A bare block sits on an engine stand. 32 parts wait on the shelf, held on by 83 bolts in eight spanner sizes.
Nobody tells you which size fits. When you think it's finished, hit **Start** — the engine tells you what you forgot.

## Play

- **Parts** opens the shelf. Pick a part, then tap its green outline on the engine. Red means something is missing or in the way.
- Pick a spanner size, then **press and hold** a bolt to turn it. **↻ / ↺** flips the ratchet.
- With the hand, tap a fitted part to inspect or remove it (undo all its bolts first).
- Drag to orbit, pinch to zoom, two fingers to pan, double-tap to focus. Mouse: drag, wheel, shift-drag.
- Progress saves automatically in the browser.

Order is only enforced where it is physically necessary, so you can close the engine up without a head gasket,
a timing chain or tight rod caps — and find out on the first start.

## Run

No build step. Serve the folder with any static server:

    npm start        # python3 -m http.server 8080

Deploys as-is to GitHub Pages or any static host.

## Test

    npm start &
    NODE_PATH=$(npm root -g) npm test   # needs Playwright

## Layout

- `js/engine.js` — every part: geometry, bolts, what it needs and what it covers
- `js/main.js` — scene, touch controls, HUD, save, start-up diagnosis
- `js/audio.js` — synthesised sounds
- `vendor/` — three.js r170 (MIT)
