# AI MAN v4: build notes

This is a static, self-contained web game. Open `index.html` from any static server, including from a sub-path. There is no build step, no CDN and no network access at runtime. Every path is relative (`./lib`, `./assets`, `./audio.js`).

## Files
| File | Purpose |
|---|---|
| `index.html` | Cover screen (title «AI MAN» + play button + loading bar with a % number), icon-only HUD, pause modal, final screen (stars, score, stats, «احصل على الكتاب» button, replay). Contains the import map `three → ./lib/three.module.min.js`. |
| `game.js` | All rendering and gameplay code (ES module). `export const BOOK_URL = '#'` is at the top. Change it to the real book link. |
| `audio.js` | The v3.2 procedural WebAudio music and SFX, reused unchanged. Tracks used: `city` (run), `escape` (robot chase), `office` (end screen). |
| `_tools/` | Dev-only helpers: a tiny static server, a headless-Chrome screenshot/console probe and GLB inspectors. They are not needed at runtime and can be deleted before deploying. |

Deploy only `index.html`, `game.js`, `audio.js`, `lib/`, `assets/` and (optionally) `img/`. That is about 4.7 MB. **Do not deploy `_claude-run1.log`** (a large agent log), `v32-src/` or `_tools/`.

## URL params
- `?autoplay=1`: skips the cover and starts running immediately.
- `?demo=1`: a simple AI drives the hero. It dodges FULL obstacles (it also predicts moving cars), jumps LOW ones, slides under HIGH ones and steers toward cards.
- `?s=NNN`: debug only. Starts at distance NNN m. Examples: `?autoplay=1&demo=1&s=555` (robot chase), `s=880` (convoy), `s=1040` (police), `s=1740` (finale).
- `window.__dbg` carries the state, distance, fps, draw calls, triangles, hits, cards and worst frame time. It is updated twice a second for automated tests.

## What was built
**Assets (all real CC0 GLBs, meshopt + WebP, loaded through GLTFLoader + MeshoptDecoder):**
- **Hero:** Quaternius Superhero_Male (no cap). It is scaled to 1.8 m, measured with Box3 after a skinned-pose update. Vertex colours are disabled (they tinted it red). A glowing chest emblem is attached to the `spine_03` bone.
- **Animations:** retargeted by bone name from `anim1`/`anim2` onto one AnimationMixer. Root-motion translation is removed: `root.position` is frozen, and the X/Y of `pelvis.position` are frozen while vertical bob is kept. The clips used are:
  - running: Sprint_Loop (time-scale follows speed)
  - jump: NinjaJump_Start, then NinjaJump_Idle_Loop
  - slide: Slide_Start, then Slide_Loop
  - hit: Hit_Knockback, then Death01 (lying, with dizzy stars)
  - cover and end screen: Idle_Loop
- **City:** the three Downtown buildings are instanced per sub-mesh.
  - Fronts are rotated ±90° to face the street, packed from their measured widths, with random height and per-instance brick tint.
  - The `Street_4Lane` tile is rotated 90°. It is 18 m wide (4 lanes plus curbs) and 6 m long.
  - Also placed: 6 m sidewalk slabs, lamps with a warm glow, traffic lights at the side-street crossings, sidewalk planters with stylised trees, bollards, manholes, AC units on the facades, zebra stripes, and parked Kenney cars at both curbs.
  - The quaternius glass is replaced by a reflective PBR material that uses a PMREM environment made from the sky.
- **Cars:** the Kenney cars are baked into one geometry each (1 draw call) and scaled ×1.5. The construction barrier is scaled to about 2.2 × 1 m. Cones (×1.45) come in rows of three.
- **Robot:** RobotExpressive, normalised to 7.2 m tall. It uses Running, Punch and Wave.

**World:** the whole level (decor, obstacles, cards, gates) is generated deterministically by distance `s` and streamed through windows. Decor is about 225 m ahead (195 m on mobile) and goes into `InstancedMesh` pools.
- Moving obstacles are pure functions of the player's distance. Respawning at a checkpoint therefore rebuilds the exact same situation.
- Collected items stay collected after a respawn.
- Ambient traffic drives in the outer lanes (oncoming on the left, same direction on the right).

**Gameplay (Pepsiman feel):** auto-run on 3 lanes (±2.4 m) with eased lane changes. Jump has 0.68 s of airtime. Slide uses the real slide animation and a low hitbox. Swiping down in the air fast-falls and then slides on landing. Inputs are buffered for 140 ms. Speed ramps from 12 to 18.5 m/s; the level is 1850 m, about 125 s.
- **Tutorial:** cones (jump), a gantry (slide), a parked car (dodge) and a barrier wall (jump). Each shows a hint arrow icon.
- **LOW obstacles:** cone rows and striped barriers.
- **HIGH obstacles:** hazard gantries with chevron boards, one lane or full width.
- **FULL obstacles:** parked cars, and oncoming cars that flash their headlights and honk as a telegraph.
- **Set-pieces:**
  - **Giant robot chase (twice):** the camera swings round to the front to show it looming, stomps shake the screen, and its shadow falls ahead. It trips and crashes, with a second front-camera shot of the fall. A robot badge shows the gap.
  - **Convoy:** three oncoming cars weave across the lanes. They settle into a lane at least 1.1 s before they reach you, with a warning icon.
  - **Police crossing (twice):** a police car with flashing red/blue lights screeches out of a side street and blocks 2 lanes. A siren plays and an arrow icon points to the open lane.
  - **Chain:** gantries alternate with barrier walls.
  - **Finale:** a book-shaped card formation, then the golden finish arch.
- **Checkpoints:** glowing cyan arches at 320, 545, 830, 1040, 1280 and 1590 m, with confetti and a green tick on the progress bar. There are no lives. A hit sends you back to the last arch with 2.2 s of blinking invincibility and a speed ramp from 80%. Stars are 3 for no hits, 2 for up to 2 hits, otherwise 1.
- **Slapstick hit:**
  - 90 ms hit-stop, a red flash and strong camera shake
  - the hero is launched up and back, tumbling, bounces, then lies down with orbiting stars
  - star, dust and spark bursts, 0.3× slow-motion easing back to normal
  - a white flash, then the respawn
- **Collectibles:** cyan prompt cards (+10) and green RAM chips (+50). They spin, glow (additive instanced quads) and burst into sparkles. The combo multiplier reaches ×2 to ×5 (shown as `×N`) and resets on a hit. Near-misses give +25.
- **Juice:**
  - dust from the feet, landing puffs, sparks while sliding
  - radial speed lines at high speed
  - squash and stretch, plus FOV kicks on jump and land; FOV also rises with speed
  - camera lean on lane changes, trauma-based shake
- **End:** the hero stops and turns, and the camera orbits to his front. A glowing 3D book (cover art, no text) rises above his head while the robot waves in the background. Confetti and a fanfare play. The final card shows stars, score and stats, the gold «احصل على الكتاب» button (→ `BOOK_URL`) and replay.

**Camera:** low chase camera behind the hero. Its X is locked to the hero, so the hero is always horizontally centred. FOV, distance and height adapt to the aspect ratio, so portrait iPhone and landscape desktop both show the hero and the road ahead.
- Cover, front and finish shots orbit the hero, so the camera swings round instead of cutting.
- The finish shot uses `setViewOffset` to keep the hero above the bottom UI.
- Obstacles are hidden just before they would clip through the chase camera.

**Look:** golden hour.
- A warm DirectionalLight casts PCF soft shadows. Its shadow camera follows the hero; the map is 2048 px on desktop and 1024 px on mobile.
- HemisphereLight, plus a gradient sky shader with a sun glow and pink clouds.
- Fog matches the horizon colour; ACES Filmic tone mapping; sRGB output.
- Interior window textures glow slightly.
- Only the hero, cars and the chasing robot cast shadows. The robot's shadow is intentional, so its silhouette falls ahead of the hero during the chase; it is only active for a few seconds.

**Rules:**
- **Text:** the only text is the cover title and the final button. The HUD uses SVG icons and numbers only.
- **No Pepsi:** no Pepsi names, logos or music.
- **Robustness:** WebGL context loss (pause, then reload on restore), resize/orientation, and auto-pause when the tab is hidden are all handled. Audio starts only after a user gesture, so there are no autoplay warnings.
- **Performance:** DPR is capped at 2 (1.5 on mobile). Shaders for lazily created objects are pre-compiled at load to avoid hitches.

## Verification done
- `node --check` passes on `game.js` and `audio.js`.
- **Full demo run** in headless Chrome on a real GPU (`?autoplay=1&demo=1`): about 127 s from start to the end screen, 0 hits, 172 cards. There were zero console errors or warnings. It held about 60 fps with 100–165 draw calls and a worst frame of 18 ms, at about 0.9 M triangles (the Downtown buildings are dense).
- **Screens checked:**
  - cover (landscape and portrait)
  - tutorial obstacles, gantry slide, barriers
  - robot front-cam and trip, convoy, police crossing
  - hit, tumble and respawn
  - finish and final screen (landscape and portrait, 390×844)
  - a run under the sub-path `/sub/aiman-v4/index.html`

## Tuning knobs (top of `game.js`)
- `L` (level length), `CPS` (checkpoints), `speedAt()` (speed curve)
- `GRAV`, `JUMP_V`, `SLIDE_T`
- `VIEW_AHEAD`: lower it on very weak phones to cut triangles
- Set-pieces and positions are in `genLevel()`

## Round 2 polish
- **Dust:** foot dust is now small, brownish-grey (`#8a7d70`), at 38% opacity and short-lived (~0.3 s). A puff spawns only when a foot plants, detected from the `ball_l`/`ball_r` bones. Jump, land and hit dust were shrunk too.
- **Particles near the camera:** for all particle systems, points closer than about 4–10 m to the camera are capped to 0.5 m, and they fade out completely within about 1.2–3.2 m. Nothing balloons into screen-filling blobs any more, in portrait or landscape.
- **Clear view of the hero:** in the chase view, nothing is drawn between the camera and the hero. Obstacles in the hero's line that are already behind him are hidden, and so are checkpoint arches once passed and missed cards or RAM chips behind him. Cars in other lanes stay visible.
- **Bug fix:** obstacle rotation (parked cars and the police car's sideways crossing) had been disabled by an editing slip in round 1. It is restored.
- **Checked:** 390×844 and 1280×720 screenshots of running, jumping, sliding, a hit and the police crossing. No console errors.

## v4.1 (Zizo feedback: controls flip in chase camera, heavy feel, graphics → "Subway Surfers level")
- **Screen-relative controls:** `act()` now records screen-relative input; `processInput()` multiplies by `screenSign()` = sign(cos(camera orbit angle)). When the camera swings round to the front for the robot chase, right still moves the hero to the right of the screen. The demo AI passes `world=true`. Lean and swipe-sound pan use the screen direction. Test: `_tools/dirtest.mjs` (projects hero vs road centre to screen-x before/after ArrowRight/ArrowLeft in both camera modes).
- **Snappier feel:** lane switch is a fixed 130 ms ease-out (was an exponential follow, ~200 ms to 95%). Gravity 48 / jump 15.2 (0.63 s airtime, same height), slide 0.7 s, fast-fall −30. Speed 13.5 → 20.5 m/s (was 12 → 18.5), start ramp 0.8→1 in ~1 s. Input buffer 240 ms, swipe threshold ~3% of the short screen side, quick flicks that end before the threshold are caught on pointerup. Animation cross-fades 50–100 ms.
- **Look:** bright sunny daytime palette (blue sky, white-warm sun, stronger hemisphere fill), Neutral tone mapping + saturation grade, PCF soft shadows up to 4096 px, PMREM sky reflections, fresnel rim light and ink outline on the hero, procedural tram-track road with lane markings, striped colourful shop awnings, cafe parasols, dumpsters, tram wires/poles, saturated facade tints.
- **New CC0 models:** Kenney Train Kit trams/metro cars as obstacles (parked "tram yard" pairs with one open lane, and oncoming trams with headlights). Hero textures now 1024 px base + 1024 px normal/roughness (was 512 px for the detail maps).
- **Quality tiers** (`?q=0..3` to force; auto-picked; auto-lowered if the average frame time over 2.5 s exceeds 22 ms):
  - 3 Ultra (desktop default): DPR up to 2, 4096 shadows, MSAA×4 HDR composer, GTAO ambient occlusion, bloom, vignette.
  - 2 High (mobile default): DPR ≤ 1.6, 1024–2048 shadows, composer with bloom + vignette (no GTAO).
  - 1 Medium: direct render with MSAA, DPR ≤ 1.35–1.5, 1024 shadows.
  - 0 Low (weak GPU / WebGL1): DPR 1, 1024 PCF shadows.
- **Verified (v4.1):** full `?autoplay=1&demo=1` run in headless Chrome on zii-desktop's real GPU (AMD Radeon integrated, D3D11): 0 hits, 153 cards, end screen at ~117 s, zero console errors or warnings. Auto quality started at tier 2 (bloom), held 45–60 fps, then stepped down to tier 1 at ~62 s and held 50–60 fps. The direction test passes in both camera modes; the v4 build fails it in the front camera. Demo AI obstacle sampling is now ~2 m (it used to skip short obstacles).
