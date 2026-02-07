/**
 * Local race data loader — loads pre-downloaded JSON files from /races/ directory.
 * No API calls, no rate limits, instant loading.
 */

// --- Types (same interfaces the app uses) ---

export interface RaceInfo {
  meeting_key: number;
  meeting_name: string;
  location: string;
  country_name: string;
  circuit_short_name: string;
  date_start: string;
  slug: string;
  fileName: string;
  totalLaps?: number;
}

export interface CompactDriver {
  n: number;       // driver_number
  code: string;    // name_acronym
  name: string;    // full_name
  team: string;    // team_name
  color: string;   // team_colour
}

export interface LoadedRaceData {
  meeting: {
    key: number;
    name: string;
    location: string;
    country: string;
    circuit: string;
    date: string;
  };
  session: {
    key: number;
    dateStart: string;
  };
  totalLaps: number;
  raceDurationMs: number;
  raceStartTime: number;
  drivers: CompactDriver[];
  bounds: {
    minX: number; maxX: number;
    minY: number; maxY: number;
    scale: number; centerX: number; centerY: number;
  };
  trackOutline: [number, number][]; // [x, y][]
  // [timestamp, {driverNum: [x,y,z]}][]
  locationSnapshots: [number, Record<string, [number, number, number]>][];
  laps: { d: number; n: number; t: string; dur: number | null }[];
  stints: { d: number; n: number; c: string; s: number; e: number; age: number }[];
  positions: { d: number; t: string; p: number }[];
  intervals: { d: number; t: string; g: number | string | null; i: number | string | null }[];
  pits: { d: number; t: string; lap: number; dur: number | null }[];
}

export type LoadProgress = {
  stage: string;
  percent: number;
};

// --- Load race index ---
let cachedIndex: RaceInfo[] | null = null;

export async function getRaceIndex(): Promise<RaceInfo[]> {
  if (cachedIndex) return cachedIndex;
  const res = await fetch('/races/index.json');
  if (!res.ok) throw new Error('Race index not found. Run the download script first.');
  cachedIndex = await res.json();
  return cachedIndex!;
}

// --- Load a single race ---
const raceCache = new Map<string, LoadedRaceData>();

export async function loadRaceData(
  slug: string,
  onProgress?: (p: LoadProgress) => void
): Promise<LoadedRaceData> {
  const report = (stage: string, percent: number) => onProgress?.({ stage, percent });

  if (raceCache.has(slug)) {
    report('Ready!', 100);
    return raceCache.get(slug)!;
  }

  report('Loading race data...', 10);
  const res = await fetch(`/races/${slug}.json`);
  if (!res.ok) throw new Error(`Race data not found: ${slug}`);
  
  report('Parsing data...', 50);
  const data: LoadedRaceData = await res.json();

  report('Ready!', 100);
  raceCache.set(slug, data);
  return data;
}

// --- Helper: Normalize coordinates to scene space ---
export function normalizeCoord(
  x: number,
  y: number,
  bounds: LoadedRaceData['bounds']
): { x: number; z: number } {
  return {
    x: (x - bounds.centerX) * bounds.scale,
    z: (y - bounds.centerY) * bounds.scale,
  };
}

// --- Helper: Interpolate car positions at a given race time ---
export function getPositionsAtTime(
  raceTimeMs: number,
  data: LoadedRaceData
): Map<number, { x: number; y: number; z: number; speed: number }> {
  const result = new Map<number, { x: number; y: number; z: number; speed: number }>();
  const snaps = data.locationSnapshots;

  if (snaps.length === 0) return result;

  // Binary search for the right time window
  let lo = 0, hi = snaps.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (snaps[mid][0] <= raceTimeMs) lo = mid;
    else hi = mid;
  }

  const [t1, drivers1] = snaps[lo];
  const [t2, drivers2] = snaps[Math.min(lo + 1, snaps.length - 1)];
  const dt = t2 - t1;
  const t = dt > 0 ? Math.max(0, Math.min(1, (raceTimeMs - t1) / dt)) : 0;

  // Get previous snapshot for speed calculation
  const prevIdx = Math.max(0, lo - 1);
  const [tPrev, driversPrev] = snaps[prevIdx];
  const timeDelta = (t1 - tPrev) / 1000; // seconds

  for (const drv of data.drivers) {
    const dn = String(drv.n);
    const p1 = drivers1[dn];
    const p2 = drivers2[dn];

    if (p1 && p2) {
      // Skip zero coordinates (pre-race / no data)
      if (p1[0] === 0 && p1[1] === 0 && p1[2] === 0) continue;
      if (p2[0] === 0 && p2[1] === 0 && p2[2] === 0) {
        // Use p1 only if p2 is zero
        result.set(drv.n, { x: p1[0], y: p1[1], z: p1[2], speed: 0 });
        continue;
      }

      const x = p1[0] + (p2[0] - p1[0]) * t;
      const y = p1[1] + (p2[1] - p1[1]) * t;
      const z = p1[2] + (p2[2] - p1[2]) * t;

      // Derive speed from position change
      let speed = 0;
      const pPrev = driversPrev[dn];
      if (pPrev && timeDelta > 0 && !(pPrev[0] === 0 && pPrev[1] === 0 && pPrev[2] === 0)) {
        const dx = p1[0] - pPrev[0];
        const dy = p1[1] - pPrev[1];
        const dz = p1[2] - pPrev[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        speed = Math.min((dist / timeDelta) * 3.6, 380); // km/h, capped
      }

      result.set(drv.n, { x, y, z, speed });
    } else if (p1) {
      // Skip zero coordinates
      if (p1[0] === 0 && p1[1] === 0 && p1[2] === 0) continue;
      result.set(drv.n, { x: p1[0], y: p1[1], z: p1[2], speed: 0 });
    }
  }

  return result;
}

// --- Helper: Get driver's current lap at a given time ---
export function getDriverLapAtTime(
  driverNumber: number,
  raceTimeMs: number,
  data: LoadedRaceData
): { lap: number; lapDuration: number | null; compound: string; tyreAge: number } {
  const raceStartEpoch = data.raceStartTime;
  const currentEpoch = raceStartEpoch + raceTimeMs;

  const driverLaps = data.laps
    .filter(l => l.d === driverNumber)
    .sort((a, b) => a.n - b.n);

  let currentLap = 1;
  let lastLapDuration: number | null = null;
  for (const lap of driverLaps) {
    const lapStartEpoch = new Date(lap.t).getTime();
    if (lapStartEpoch <= currentEpoch) {
      currentLap = lap.n;
      lastLapDuration = lap.dur;
    }
  }

  // Find current stint for tyre info
  const driverStints = data.stints
    .filter(s => s.d === driverNumber)
    .sort((a, b) => a.n - b.n);

  let compound = 'UNKNOWN';
  let tyreAge = 0;
  for (const stint of driverStints) {
    if (currentLap >= stint.s && currentLap <= stint.e) {
      compound = stint.c;
      tyreAge = stint.age + (currentLap - stint.s);
      break;
    }
  }

  return { lap: currentLap, lapDuration: lastLapDuration, compound, tyreAge };
}

// --- Helper: Get interval/gap at time ---
export function getDriverIntervalAtTime(
  driverNumber: number,
  raceTimeMs: number,
  data: LoadedRaceData
): { gap: string; interval: string } {
  const raceStartEpoch = data.raceStartTime;
  const currentEpoch = raceStartEpoch + raceTimeMs;

  const driverIntervals = data.intervals
    .filter(i => i.d === driverNumber)
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

  let gap = '';
  let interval = '';
  for (const iv of driverIntervals) {
    if (new Date(iv.t).getTime() <= currentEpoch) {
      gap = iv.g != null ? String(iv.g) : '';
      interval = iv.i != null ? String(iv.i) : '';
    } else break;
  }

  return { gap, interval };
}

// --- Helper: Get position at time ---
export function getDriverPositionAtTime(
  driverNumber: number,
  raceTimeMs: number,
  data: LoadedRaceData
): number {
  const raceStartEpoch = data.raceStartTime;
  const currentEpoch = raceStartEpoch + raceTimeMs;

  const driverPositions = data.positions
    .filter(p => p.d === driverNumber)
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

  let pos = 20;
  for (const p of driverPositions) {
    if (new Date(p.t).getTime() <= currentEpoch) {
      pos = p.p;
    } else break;
  }
  return pos;
}
