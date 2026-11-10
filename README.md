# Bolt by Bolt

A first-person mobile web game: you live in a garage and build an engine, one bolt at a time.

You wake up in a two-car garage, half of it walled off as a bedroom, kitchen and bathroom.
A 2010-ish sport coupe sits in the bay — rolling shell, gearbox, one seat, steering wheel, dash and shifter, no doors, no engine.
A bare engine block hangs on a stand. 32 engine parts are on the shelf along the back wall, held on by 83 bolts in eight spanner sizes.
Nobody tells you which size fits.

## Play

- **Move** with your left thumb, **look** by dragging anywhere else, **tap** things to use them. Keyboard: WASD, drag to look, C to crouch.
- Tap a part on the shelf to grab it. Parts lie any way up: **Turn** and **Flip** it until it faces the way it fits, hold it up to its place on the engine, and **drop it in**. Up close an outline shows green (lines up), amber (wrong way round) or red (something missing or in the way). **Put down** rests it where you are looking.
- Pick a spanner size and **press and hold** a bolt to turn it. **↻ / ↺** flips the ratchet. **Crouch** to reach the underside.
- Tap a fitted part to take it off again once its bolts are undone.
- **Energy, hunger, thirst**: eat at the fridge or stove, drink from a tap, sleep in the bed. At zero energy you collapse and lose hours.
- A day lasts **15 minutes**. Progress saves automatically in the browser.
- When you think the engine is done, hit **Start**. Order is only enforced where it is physically necessary, so a forgotten head gasket or loose rod caps show up on the first start.

## Run

No build step. Serve the folder with any static server:

    npm start        # python3 -m http.server 8080

Deploys as-is to GitHub Pages or any static host.

## Test

    npm start &
    NODE_PATH=$(npm root -g) npm test   # needs Playwright

## Layout

- `js/engine.js` — every engine part: geometry, bolts, what it needs and what it covers
- `js/world.js` — garage floor plan, living quarters, the car, colliders
- `js/main.js` — player, touch controls, carrying parts, survival, day cycle, HUD, save, start-up diagnosis
- `js/audio.js` — synthesised sounds
- `vendor/` — three.js r170 (MIT)

## Not built yet

Lifting the finished engine into the car, driving, the bathroom doing anything, and whatever is behind the side door.
