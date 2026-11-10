# Bolt by Bolt

A first-person mobile web game: you live in a garage and build an engine, one bolt at a time.

You wake up in a two-car garage, half of it walled off as a bedroom, kitchen and bathroom.
A red early-90s fastback sits in the bay — rolling shell, gearbox, one seat, steering wheel, dash and shifter, no doors, no engine.
A bare engine block hangs on a stand. 34 engine parts are on the shelf along the back wall, held on by 91 bolts in eight spanner sizes.
Nobody tells you which size fits.

## Play

- **Move** with your left thumb, **look** by dragging anywhere else, **tap** things to use them. Keyboard: WASD, drag to look, C to crouch.
- Tap a part on the shelf to grab it. Parts lie any way up: **Turn** and **Flip** it until it faces the way it fits, hold it up to its place on the engine, and **drop it in**. Up close an outline shows green (lines up), amber (wrong way round) or red (something missing or in the way). **Put down** rests it where you are looking.
- Pick a spanner size and **press and hold** a bolt to turn it. **↻ / ↺** flips the ratchet. **Crouch** to reach the underside.
- Tap a fitted part to take it off again once its bolts are undone.
- **Energy, hunger, thirst**: eat at the fridge or stove, drink from a tap, sleep in the bed. At zero energy you collapse and lose hours.
- A day lasts **15 minutes**. Progress saves automatically in the browser.
- When you think the engine is done, hit **Start**. Order is only enforced where it is physically necessary, so a forgotten head gasket or loose rod caps show up on the first start.

## Models

Everything is modelled in code at true size (1 unit = 10 cm) from real-world reference dimensions, listed at the top of each file:

- **Engine** (`js/engine.js`): a 1.6 L SOHC eight-valve four — 81 mm bore, 86.4 mm stroke, 88 mm bore spacing, 144 mm rods,
  five 54 mm main bearings, 270 mm flywheel with ring gear, 3/8" roller timing chain. Fastener heads are true size, so the
  spanner size is the distance across the flats.
- **Car** (`js/car.js`): an S13-style fastback traced from a dimensioned blueprint and reference photos — 4.535 m long, 1.69 m wide, 1.29 m high,
  2.475 m wheelbase, 195/60 R15 tyres on seven-spoke alloys. Wedge nose, sloping hatch glass, black pillars, lip spoiler. No badges.
- **Garage** (`js/world.js`): 6 x 8.7 m, 2.8 m ceiling, 2.2 m door opening, standard furniture and worktop sizes.

Surface finishes (sand-cast iron and aluminium, machined steel, crinkle paint, rust, tyre tread) are generated procedurally.
`__game.audit()` checks every mesh for non-finite coordinates, zero-area triangles, open edges and inside-out faces;
the smoke test fails if it finds any.

## Run

No build step. Serve the folder with any static server:

    npm start        # python3 -m http.server 8080

Live at https://exyoff.github.io/StickBurn/ — every push to `main` is copied to the `gh-pages` branch, which GitHub Pages serves.

## Test

    npm start &
    NODE_PATH=$(npm root -g) npm test   # needs Playwright

## Layout

- `js/geo.js` — modelling kit: materials, procedural textures, closed-solid geometry helpers
- `js/engine.js` — every engine part: geometry, bolts, what it needs and what it covers
- `js/car.js` — the coupe: lofted body shell, wheels, cabin, engine bay
- `js/world.js` — garage floor plan, living quarters, colliders
- `js/main.js` — player, touch controls, carrying parts, survival, day cycle, HUD, save, start-up diagnosis
- `js/audio.js` — synthesised sounds
- `vendor/` — three.js r170 (MIT)

## Not built yet

Lifting the finished engine into the car, driving, the bathroom doing anything, and whatever is behind the side door.
