# Bolt by Bolt

A first-person mobile web game: you live in a garage and build an engine, one bolt at a time.

You wake up in a two-car garage, half of it walled off as a bedroom, kitchen and bathroom.
A red early-90s fastback sits in the bay — rolling shell, gearbox, one seat, steering wheel, dash and shifter, no doors, no engine.
A bare engine block hangs on a stand. 34 engine parts are on the shelf along the back wall, held on by 91 bolts in eight spanner sizes.
Nobody tells you which size fits.

## Play

You look with a crosshair and act with buttons, My Summer Car style.

- **Left stick** walks, **right stick** looks. The dot in the middle of the screen is what you act on; its name appears under it.
- Point at a part on the shelf and press **Grab**. Parts lie any way up: **Turn** and **Flip** the one you are carrying until it
  faces the way it fits, hold it up to its place on the engine, and press **Drop in**. Up close an outline shows green (lines up),
  amber (wrong way round) or red (something missing or in the way). Spark plugs, the belt and the chain fit any way round.
  **Put down** rests a part where you are looking.
- Pick a spanner size along the bottom, point at a bolt and hold **Tighten**. **Loosen** undoes it. **Crouch** to reach the underside.
- Point at a fitted part with all its bolts undone and press **Take off**.
- A day lasts **15 minutes**; the bed skips the night. Progress saves automatically in the browser.
- Keyboard: WASD walk, arrows or mouse-drag look, E act, R turn, F flip, Z tighten, X loosen, C crouch, 1–8 spanner.

Order is only enforced where it is physically necessary. Starting the engine, and hunger, thirst and energy, are switched off for now.

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
- `js/main.js` — player, joysticks and buttons, crosshair aiming, carrying parts, day cycle, HUD, save
- `js/audio.js` — synthesised sounds
- `vendor/` — three.js r170 (MIT)

## Not built yet

Starting the engine, lifting it into the car, driving, hunger/thirst/energy, the kitchen and bathroom doing anything, and whatever is behind the side door.
