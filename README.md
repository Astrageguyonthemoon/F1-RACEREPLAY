# F1 Race Replay

A web-based Formula 1 race replay viewer built with React and Three.js. Watch real 2025 season races play out on a 2D track map with actual driver position data from the OpenF1 API.
<img width="1919" height="875" alt="image" src="https://github.com/user-attachments/assets/11bf22b9-8e62-45a3-9a19-b15adc73b63c" />

## What it does

- Replays 9 races from the 2025 F1 season using real telemetry data
- Shows 10 drivers per race (selected by data coverage) as colored dots on the track outline
- Playback speed controls: 1x, 4x, 16x, 64x
- Live timing overlay with lap count, intervals, and position numbers
- 2D map view and 3D camera modes (TV cam, onboard) for simulated races

### Races included

Australian GP, Bahrain GP, Saudi Arabian GP, Japanese GP, Chinese GP, Miami GP, Emilia Romagna GP, Monaco GP, Spanish GP
<img width="1919" height="865" alt="image" src="https://github.com/user-attachments/assets/62622c87-ac67-4fc3-8ce2-4a68968f5339" />

## Tech stack

- **React 19** + TypeScript
- **Three.js** / React Three Fiber / Drei for rendering
- **Vite** for bundling
- **OpenF1 API** (data pre-downloaded as static JSON)

Race data (~70MB) is bundled in `public/races/` so the app works without any API calls at runtime.

## Run locally

```
npm install
npm run dev
```

Opens at `http://localhost:5173`

## How the data works

Race data was downloaded from the [OpenF1 API](https://openf1.org/) using the included script:

```
npm run download-races
```

This pulls location snapshots, lap data, intervals, and position data for each race, then bundles them into JSON files. A post-processing script (`scripts/fix-race-data.mjs`) cleans up zero-coordinate entries that appear at the start of some sessions.

The track outline is built from the race leader's position data — no separate track geometry files needed.

## Project structure

```
App.tsx                  → Main app, race loading, playback loop, UI
components/
  Scene3D.tsx            → Three.js canvas, camera controls
  Track.tsx              → Track outline rendering (2D/3D)
  Car.tsx                → Driver dots / 3D car models
services/
  raceData.ts            → Loads JSON files, binary search for positions
  trackData.ts           → Simulated mode data, driver list
scripts/
  download-races.mjs     → Fetches race data from OpenF1
  fix-race-data.mjs      → Cleans up bad coordinate entries
public/races/            → Pre-downloaded race JSON files
```

## Deploy

Push to GitHub and import on [Vercel](https://vercel.com). It auto-detects Vite — no config needed.

## License

MIT
