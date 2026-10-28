# Project brief for Claude Code

This repo is Misha's fork of **Mutable Dreams 1.2** (kidbee85-beep/mutable-dreams), custom firmware for the **M-VAVE FM-1** synth. We are turning it into a simpler, generative instrument with a **Markov "brain"** that learns what you play and improvises in your style. Working name: **MARKOV DREAMS** (final name TBD; must differ from "Mutable Dreams").

Misha is comfortable with HTML/JS but not deeply experienced with C/C++ or CLI tooling. Explain decisions plainly, keep changes small and reviewable, and after each change produce a playable browser build he can try.

## License obligations (do not skip)
- The combined work is **GPL-3.0-only**. Keep it GPL, keep every existing notice (Mutable Instruments MIT, fm1-base / felucca-bsp MPL-2.0, fonts OFL).
- Upstream asks forks to credit Mutable Dreams and its upstream authors and to use **their own name and visual identity**: change the name, splash and colours, keep the credits.

## Build
- Browser build (works on Linux):
  ```sh
  python3 -m pip install Pillow
  export WASI_SDK=/path/to/wasi-sdk   # wasi-sdk 27 worked; release used 34
  python3 tools/build_local.py web
  python3 tools/package_web.py            # writes app/build/browser/index.html (one self-contained file)
  ```
  Serve `app/build/browser/` over HTTP to test. Don't open `web/index.html` directly (it is a template).
  The page uses the prototype's panel layout (`reference/markov-sid/prototype.html`): wide on a computer, panel over a full-width keyboard in portrait on a phone. All sound and screen pixels come from the firmware. The old 1.2 release page is kept in `web/legacy/`.
- Native DSP checks: `python3 tools/build_local.py dsp --sanitize` then `app/build/san/dsp-tests` (needs `libclang-rt-18-dev` on Ubuntu; the setup script installs it).
- UI check: `python3 tools/build_local.py host` then `app/build/native/mutable-dreams-host tests/markov_ui.txt OUTDIR` (the whole Markov Dreams workflow; `shot FILE.png` lines save screenshots). The 1.2 UI scripts are kept, not run, in `tests/legacy-1.2/`.
- Browser engine checks: `node tests/web_engine.mjs`, `node tests/web_storage.mjs` (after the web build).
- Published builds: `.github/workflows/browser-build.yml` builds every push into the `gh-pages` branch: `https://umptycandy.github.io/markov-dreams/builds/<branch>/`, and `main` is also the front page.
- Device firmware: needs the JieLi Linux pi32v2 toolchain + AC79NN SDK V1.2.1 (see BUILDING.md). Plan: build it in **GitHub Actions on ubuntu** later, not now.
- **Never remove the OTA/update path.** The FM-1 has no recovery button; firmware must stay re-flashable over USB MIDI SysEx.
- CPU: the released build peaked at **88% load**. Do not add heavy DSP. The Markov brain is control logic only and must stay cheap.

## Where things are
- `app/dsp/dreams.cpp` / `dreams.h`: 6-track engine, sequencing (`md_sequence`, 32 steps, 4 generators), shared grain cloud, delay, room. Everything is driven through `md_command(cmd, track, value)`.
- `app/app.c`: platform glue, input loop (`app_input_only`), intro/help cards, and the hidden 1.2 pages.
- `app/markov.c`: the Markov Dreams surface: main / sound / global pages, pop-ups, track buttons, TEACH / FREEZE / ARP, key lights, and scheduling one bar ahead.
- `app/brain.c`: the Markov brain (port of `brain.js`): fixed tables, presets, `br_generate`, `br_to_md`. Bars reach the engine through `md_queue_bar()` in dreams.cpp (applied at the bar line; ratchets, long notes and 50 Hz chip arps).
- `web/`: browser shell and worklet. `presets/`: biomes/tones.
- `reference/markov-sid/`: the browser prototype this design comes from. `brain.js` is the Markov brain to port, and `prototype.html` is the full playable prototype with the control layout.

## Target design (from the prototype)

### Tracks: 4 buttons over MD's 6 tracks
| Button (FM-1 label) | Our name | Mutable Dreams tracks |
|---|---|---|
| FX | DRM | kick, snare, hat (MD tracks 0-2) |
| SEL | BAS | bass track |
| ENV | LED | lead track |
| LFO | CHD | chords track |
Verified (step 1): factory biomes order their tracks freely (bass is usually track 1; only about 20 of 93 have kick/snare/hat in 0-2). So `band_layout()` in dreams.cpp reorders every kit on load into kick, snare, hat, bass, lead, chords, borrowing a spare track with a warm default tone when a role is missing. A DSP test checks all 93 kits.

### Controls
- **PRESETS knob = KIT:** choose a biome (whole band).
- **ALGORITHM = BRAIN:** choose a Markov brain preset (DARK ARP, HYPER BASS, BROKEN 4/4, GLASS, BLANK; retune these for the warmer sound).
- **SELECT = TEMPO. MASTER pot = VOLUME.**
- **KNOB 1–4 (main page):** WILD (Markov temperature, plus stutters at high values), DENSITY, TONE (overall brightness; replaces the old DIRT, since the goal is less harsh), CLOUD.
  - **CLOUD** = the existing MD grain cloud, simplified to one knob. It raises grain send + reverb on **LEAD and CHORDS only**; drums and bass stay dry. Fixed, musical grain size/position defaults.
- **Hold a track button + turn knobs** = shape that track's sound. KNOB 1 picks the engine (MD model valid for that role), KNOB 2–4 = TONE, HARM, DECAY. The screen shows that track's sound page while held. Release returns to the main page.
- **GLO** toggles a global page: knobs become SWING, ROOT, SCALE, PUMP (MD_SWING, MD_ROOT, MD_SCALE, MD_DUCK).
- **ARP:** toggle arps for the selected track.
- **SEQ = FREEZE:** lock the current bar/phrase (stop it evolving).
- **PLAY/STOP.** **REC = TEACH:** while looping, the keys you play on the selected track are learned.
- **Remove from the surface:** biome browser pages, the deep FX pages, mixer, banks UI, MIDI pages. Keep the code if it's simpler to hide than delete. EDIT, HOME and SAVE can stay greyed/unused for now.
- **Screen:** one main page with the 4 track lanes (16 steps), current brain + tempo on top, knob values along the bottom. Plus the sound page (while holding) and the global page.

### Markov brain (port `reference/markov-sid/brain.js` to C, app layer)
- Per note track: first-order transition counts between notes (stored as semitone intervals from the root), plus per-step onset counts over the bars taught.
- Drums: per-lane (kick/snare/hat) per-step onset counts.
- Generation per bar: onset if rand < shaped probability (DENSITY scales it, WILD flattens it). Next note is sampled from the transition row with temperature (`weight^(1/T)`). At high WILD, also make random scale-tone jumps. Quantise to the scale. Optional ratchets and half-bar stutters at high WILD.
- Write generated bars into each track's `md_sequence` (or add a generator 4 = MARKOV inside dreams.cpp, whichever is cleaner). Regenerate each bar unless FREEZE.
- TEACH: quantise played notes to the nearest step and add them to the brain. Bars count only if something was played.
- Keep brains small, with fixed-size tables suited to flash/RAM. Saving brains to flash comes later.

### Later (not now)
- **Voice:** use the CHOIR model (or Plaits speech) to sing made-up syllables generated by the brain, with line endings rhyming across 2-bar/4-bar phrases (AABB or ABAB).
- Device build in GitHub Actions; release packaging.

## Working style
- One step at a time. After each step: build the browser version, run the DSP checks, summarise what changed in plain English, and push a branch.
- Suggested order:
  1. Rename/identity + 4-button track mapping + simplified main screen. (done)
  2. Knob/global/hold-to-edit mapping + CLOUD simplification. (done)
  3. Markov brain port + TEACH + FREEZE. (done; brains live in RAM until power off)
  4. Tuning brains and biomes for the warmer sound.
  5. Device build in CI.
