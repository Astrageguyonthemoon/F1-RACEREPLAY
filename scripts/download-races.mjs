/**
 * Download all 2025 F1 race data from OpenF1 API and save as pre-processed JSON files.
 * 
 * Usage: node scripts/download-races.mjs
 * 
 * This fetches ALL drivers for each race, processes data into the snapshot format
 * the app needs, and saves to public/races/. Takes ~30-40 min due to API rate limits.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'https://api.openf1.org/v1';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'races');
const YEAR = 2025;
const REQUEST_DELAY = 1500; // 1.5s between requests to be safe

// --- Rate-limited fetch ---
let lastRequestTime = 0;

async function apiFetch(endpoint, params = {}) {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const url = `${BASE_URL}${endpoint}?${query}`;
  
  // Enforce delay between requests
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < REQUEST_DELAY) {
    await sleep(REQUEST_DELAY - elapsed);
  }
  
  for (let attempt = 0; attempt < 5; attempt++) {
    lastRequestTime = Date.now();
    try {
      const res = await fetch(url);
      
      if (res.status === 429) {
        const wait = REQUEST_DELAY * Math.pow(2, attempt + 1);
        console.warn(`  ⚠ Rate limited, waiting ${(wait/1000).toFixed(1)}s... (attempt ${attempt + 1}/5)`);
        await sleep(wait);
        continue;
      }
      
      if (!res.ok) {
        console.warn(`  ⚠ HTTP ${res.status} for ${endpoint} - ${res.statusText}`);
        if (attempt < 4) {
          await sleep(3000);
          continue;
        }
        return [];
      }
      
      const data = await res.json();
      return data;
    } catch (err) {
      console.warn(`  ⚠ Network error: ${err.message}`);
      if (attempt < 4) {
        await sleep(3000);
        continue;
      }
      return [];
    }
  }
  return [];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// --- Main download flow ---
async function downloadAllRaces() {
  console.log(`\n🏎  F1 Race Data Downloader — ${YEAR} Season\n`);
  
  // Create output dir
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  // 1. Get all meetings for the year
  console.log('📋 Fetching meetings list...');
  const meetings = await apiFetch('/meetings', { year: YEAR });
  console.log(`   Found ${meetings.length} meetings\n`);
  
  if (meetings.length === 0) {
    console.error('No meetings found! Check if the API has data for this year.');
    process.exit(1);
  }

  // Save meetings index
  const meetingsIndex = meetings.map(m => ({
    meeting_key: m.meeting_key,
    meeting_name: m.meeting_name,
    location: m.location,
    country_name: m.country_name,
    circuit_short_name: m.circuit_short_name,
    date_start: m.date_start,
  }));

  const successfulRaces = [];

  for (let mi = 0; mi < meetings.length; mi++) {
    const meeting = meetings[mi];
    const slug = meeting.meeting_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    
    const outFile = path.join(OUTPUT_DIR, `${slug}.json`);
    
    // Skip if already downloaded
    if (fs.existsSync(outFile)) {
      console.log(`✅ [${mi + 1}/${meetings.length}] ${meeting.meeting_name} — already exists, skipping`);
      successfulRaces.push({
        ...meetingsIndex[mi],
        slug,
        fileName: `${slug}.json`,
      });
      continue;
    }
    
    console.log(`\n🏁 [${mi + 1}/${meetings.length}] ${meeting.meeting_name} (${meeting.location})`);
    
    try {
      const raceData = await downloadSingleRace(meeting);
      if (raceData) {
        const json = JSON.stringify(raceData);
        fs.writeFileSync(outFile, json);
        const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
        console.log(`   💾 Saved: ${slug}.json (${sizeMB} MB)`);
        successfulRaces.push({
          ...meetingsIndex[mi],
          slug,
          fileName: `${slug}.json`,
          totalLaps: raceData.totalLaps,
        });
      } else {
        console.log(`   ⏭ No race session found, skipping`);
      }
    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
    }
  }

  // Save index file
  const indexFile = path.join(OUTPUT_DIR, 'index.json');
  fs.writeFileSync(indexFile, JSON.stringify(successfulRaces, null, 2));
  console.log(`\n📁 Saved race index: index.json (${successfulRaces.length} races)`);
  console.log(`\n✨ Done! ${successfulRaces.length}/${meetings.length} races downloaded.\n`);
}

async function downloadSingleRace(meeting) {
  const meetingKey = meeting.meeting_key;
  
  // Get race session
  console.log('   📡 Getting sessions...');
  const sessions = await apiFetch('/sessions', { meeting_key: meetingKey });
  const raceSession = sessions.find(s => s.session_name === 'Race');
  
  if (!raceSession) return null;
  
  const sessionKey = raceSession.session_key;
  
  // Get drivers
  console.log('   📡 Getting drivers...');
  const drivers = await apiFetch('/drivers', { session_key: sessionKey });
  console.log(`   Found ${drivers.length} drivers`);
  
  if (drivers.length === 0) return null;
  
  const driverNumbers = drivers.map(d => d.driver_number);
  
  // Get location data per driver
  console.log(`   📡 Getting locations for ${driverNumbers.length} drivers...`);
  const allLocations = [];
  for (let i = 0; i < driverNumbers.length; i++) {
    const dn = driverNumbers[i];
    process.stdout.write(`   📡 Driver ${i + 1}/${driverNumbers.length} (#${dn})...`);
    const locs = await apiFetch('/location', { session_key: sessionKey, driver_number: dn });
    allLocations.push(...locs);
    console.log(` ${locs.length} points`);
  }
  
  // Get race info
  console.log('   📡 Getting laps...');
  const laps = await apiFetch('/laps', { session_key: sessionKey });
  
  console.log('   📡 Getting stints...');
  const stints = await apiFetch('/stints', { session_key: sessionKey });
  
  console.log('   📡 Getting positions...');
  const positions = await apiFetch('/position', { session_key: sessionKey });
  
  console.log('   📡 Getting intervals...');
  const intervals = await apiFetch('/intervals', { session_key: sessionKey });
  
  console.log('   📡 Getting pit stops...');
  const pits = await apiFetch('/pit', { session_key: sessionKey });
  
  // --- PROCESS DATA ---
  console.log('   ⚙ Processing data...');
  
  // Compact driver info
  const compactDrivers = drivers.map(d => ({
    n: d.driver_number,
    code: d.name_acronym,
    name: d.full_name,
    team: d.team_name,
    color: d.team_colour,
  }));
  
  // Find race time bounds (avoid Math.min/max spread — stack overflow with 800K+ elements)
  let raceStartTime = Infinity;
  let raceEndTime = -Infinity;
  for (const loc of allLocations) {
    const t = new Date(loc.date).getTime();
    if (!isNaN(t)) {
      if (t < raceStartTime) raceStartTime = t;
      if (t > raceEndTime) raceEndTime = t;
    }
  }
  if (raceStartTime === Infinity) {
    console.log('   ⚠ No location data found');
    return null;
  }
  
  // Group locations into snapshots (rounded to 500ms for compression)
  // Using 500ms bins instead of 100ms reduces data ~5x with minimal quality loss
  const timeMap = new Map();
  for (const loc of allLocations) {
    const t = Math.round((new Date(loc.date).getTime() - raceStartTime) / 500) * 500;
    if (!timeMap.has(t)) timeMap.set(t, {});
    // Round coords to integers (they're in mm precision from the API)
    timeMap.get(t)[loc.driver_number] = [
      Math.round(loc.x),
      Math.round(loc.y),
      Math.round(loc.z),
    ];
  }
  
  // Convert to sorted array: [timestamp, {driverNum: [x,y,z], ...}]
  const locationSnapshots = Array.from(timeMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([t, drivers]) => [t, drivers]);
  
  // Build track outline from leader's first lap
  const leaderNumber = driverNumbers[0];
  const leaderLocs = allLocations
    .filter(l => l.driver_number === leaderNumber)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  let trackOutline = [];
  if (leaderLocs.length > 100) {
    const startX = leaderLocs[0].x;
    const startY = leaderLocs[0].y;
    let foundLoop = false;
    
    for (let i = 50; i < leaderLocs.length && i < 2000; i++) {
      trackOutline.push([Math.round(leaderLocs[i].x), Math.round(leaderLocs[i].y)]);
      const dx = leaderLocs[i].x - startX;
      const dy = leaderLocs[i].y - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (i > 200 && dist < 500) {
        foundLoop = true;
        break;
      }
    }
    if (!foundLoop) {
      trackOutline = leaderLocs.slice(0, 1000).map(l => [Math.round(l.x), Math.round(l.y)]);
    }
  }
  
  // Compute bounds (loop to avoid stack overflow)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const loc of allLocations) {
    if (loc.x < minX) minX = loc.x;
    if (loc.x > maxX) maxX = loc.x;
    if (loc.y < minY) minY = loc.y;
    if (loc.y > maxY) maxY = loc.y;
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = 200 / Math.max(rangeX, rangeY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  
  // Compact laps: only keep useful fields
  const compactLaps = laps.map(l => ({
    d: l.driver_number,
    n: l.lap_number,
    t: l.date_start,
    dur: l.lap_duration,
  }));
  
  // Compact stints
  const compactStints = stints.map(s => ({
    d: s.driver_number,
    n: s.stint_number,
    c: s.compound,
    s: s.lap_start,
    e: s.lap_end,
    age: s.tyre_age_at_start,
  }));
  
  // Compact positions
  const compactPositions = positions.map(p => ({
    d: p.driver_number,
    t: p.date,
    p: p.position,
  }));
  
  // Compact intervals
  const compactIntervals = intervals.map(iv => ({
    d: iv.driver_number,
    t: iv.date,
    g: iv.gap_to_leader,
    i: iv.interval,
  }));
  
  // Compact pits
  const compactPits = pits.map(p => ({
    d: p.driver_number,
    t: p.date,
    lap: p.lap_number,
    dur: p.stop_duration,
  }));
  
  const totalLaps = laps.length > 0 ? Math.max(...laps.map(l => l.lap_number)) : 0;
  
  return {
    meeting: {
      key: meetingKey,
      name: meeting.meeting_name,
      location: meeting.location,
      country: meeting.country_name,
      circuit: meeting.circuit_short_name,
      date: meeting.date_start,
    },
    session: {
      key: sessionKey,
      dateStart: raceSession.date_start,
    },
    totalLaps,
    raceDurationMs: raceEndTime - raceStartTime,
    raceStartTime,
    drivers: compactDrivers,
    bounds: { minX, maxX, minY, maxY, scale, centerX, centerY },
    trackOutline,
    locationSnapshots,
    laps: compactLaps,
    stints: compactStints,
    positions: compactPositions,
    intervals: compactIntervals,
    pits: compactPits,
  };
}

downloadAllRaces().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
