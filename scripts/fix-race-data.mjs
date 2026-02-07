/**
 * Post-process existing race data JSON files to fix:
 * 1. Strip leading zero-coordinate snapshots (pre-race/grid period)
 * 2. Rebuild trackOutline from actual non-zero leader positions
 * 3. Recalculate bounds from non-zero coordinates only
 * 4. Adjust timestamps so race starts from first valid data
 * 5. Regenerate index.json
 *
 * Usage: node scripts/fix-race-data.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RACES_DIR = path.join(__dirname, '..', 'public', 'races');

function isZeroCoord(coord) {
  return coord[0] === 0 && coord[1] === 0 && coord[2] === 0;
}

function hasEnoughNonZeroDrivers(snapshot, minDrivers = 5) {
  const [_ts, drivers] = snapshot;
  let count = 0;
  for (const dn of Object.keys(drivers)) {
    const c = drivers[dn];
    if (c && !isZeroCoord(c)) {
      count++;
      if (count >= minDrivers) return true;
    }
  }
  return false;
}

function fixRaceFile(filePath) {
  const name = path.basename(filePath);
  console.log(`\n🔧 Processing: ${name}`);

  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  const snaps = data.locationSnapshots;
  console.log(`   Snapshots: ${snaps.length}`);

  // --- 1. Find first snapshot with enough non-zero drivers ---
  let firstValidIdx = 0;
  for (let i = 0; i < snaps.length; i++) {
    if (hasEnoughNonZeroDrivers(snaps[i], 5)) {
      firstValidIdx = i;
      break;
    }
  }

  const timeOffset = snaps[firstValidIdx][0]; // ms to subtract
  console.log(`   First valid snapshot: index ${firstValidIdx}, timestamp ${timeOffset}ms (${(timeOffset / 1000).toFixed(1)}s in)`);
  console.log(`   Stripping ${firstValidIdx} zero-data snapshots`);

  // Strip leading zero snapshots and adjust timestamps
  const trimmedSnaps = snaps.slice(firstValidIdx).map(([ts, drivers]) => {
    // Also remove individual drivers that are still [0,0,0]
    const cleanDrivers = {};
    for (const [dn, coord] of Object.entries(drivers)) {
      if (!isZeroCoord(coord)) {
        cleanDrivers[dn] = coord;
      }
    }
    return [ts - timeOffset, cleanDrivers];
  });

  // Remove any remaining snapshots where ALL drivers are zero (shouldn't be many after trim)
  const finalSnaps = trimmedSnaps.filter(([_ts, drivers]) => Object.keys(drivers).length > 0);

  console.log(`   Trimmed snapshots: ${finalSnaps.length} (removed ${snaps.length - finalSnaps.length})`);

  // --- 2. Recalculate bounds from non-zero coordinates ---
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [_ts, drivers] of finalSnaps) {
    for (const coord of Object.values(drivers)) {
      const [x, y, _z] = coord;
      if (x === 0 && y === 0) continue; // skip any remaining zeros
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = 200 / Math.max(rangeX, rangeY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  console.log(`   Bounds: X[${minX}, ${maxX}] Y[${minY}, ${maxY}] scale=${scale.toFixed(6)} center=[${centerX.toFixed(0)}, ${centerY.toFixed(0)}]`);

  // --- 3. Rebuild track outline from leader's positions ---
  // Find the driver who appears in the most snapshots (likely the leader / race winner)
  const driverCounts = {};
  for (const [_ts, drivers] of finalSnaps) {
    for (const dn of Object.keys(drivers)) {
      driverCounts[dn] = (driverCounts[dn] || 0) + 1;
    }
  }
  const leaderNum = Object.entries(driverCounts)
    .sort(([, a], [, b]) => b - a)[0]?.[0];

  if (!leaderNum) {
    console.log('   ⚠ No leader found, skipping track outline');
  } else {
    console.log(`   Track outline leader: driver #${leaderNum}`);

    // Collect leader's positions in time order
    const leaderPositions = [];
    for (const [_ts, drivers] of finalSnaps) {
      const coord = drivers[leaderNum];
      if (coord && !isZeroCoord(coord)) {
        leaderPositions.push([coord[0], coord[1]]);
      }
    }

    console.log(`   Leader has ${leaderPositions.length} valid positions`);

    // Find a lap loop: start from ~50 positions in (skip pit exit), look for when they return close to start
    let trackOutline = [];
    if (leaderPositions.length > 200) {
      const startX = leaderPositions[50][0];
      const startY = leaderPositions[50][1];
      let foundLoop = false;

      for (let i = 50; i < leaderPositions.length && i < 3000; i++) {
        trackOutline.push(leaderPositions[i]);
        if (i > 250) {
          const dx = leaderPositions[i][0] - startX;
          const dy = leaderPositions[i][1] - startY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 500) {
            foundLoop = true;
            break;
          }
        }
      }

      if (!foundLoop) {
        // Just use positions 50 through 1050 as best guess
        trackOutline = leaderPositions.slice(50, 1050);
      }

      console.log(`   Track outline: ${trackOutline.length} points (loop=${foundLoop})`);
    } else {
      trackOutline = leaderPositions;
      console.log(`   Track outline: ${trackOutline.length} points (all available)`);
    }

    data.trackOutline = trackOutline;
  }

  // --- 4. Update data ---
  data.locationSnapshots = finalSnaps;
  data.bounds = { minX, maxX, minY, maxY, scale, centerX, centerY };
  data.raceDurationMs = finalSnaps.length > 0 ? finalSnaps[finalSnaps.length - 1][0] : 0;
  // Keep raceStartTime adjusted
  data.raceStartTime = data.raceStartTime + timeOffset;

  // --- 5. Write back ---
  const json = JSON.stringify(data);
  fs.writeFileSync(filePath, json);
  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  console.log(`   💾 Saved: ${name} (${sizeMB} MB)`);

  return {
    slug: name.replace('.json', ''),
    fileName: name,
    meeting_key: data.meeting.key,
    meeting_name: data.meeting.name,
    location: data.meeting.location,
    country_name: data.meeting.country,
    circuit_short_name: data.meeting.circuit,
    date_start: data.meeting.date,
    totalLaps: data.totalLaps,
  };
}

// --- Main ---
console.log('🏎  F1 Race Data Post-Processor\n');

const files = fs.readdirSync(RACES_DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
console.log(`Found ${files.length} race files to process`);

const indexEntries = [];
for (const file of files) {
  try {
    const entry = fixRaceFile(path.join(RACES_DIR, file));
    if (entry) indexEntries.push(entry);
  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`);
  }
}

// Regenerate index.json
const indexPath = path.join(RACES_DIR, 'index.json');
fs.writeFileSync(indexPath, JSON.stringify(indexEntries, null, 2));
console.log(`\n📁 Regenerated index.json with ${indexEntries.length} races`);
console.log('\n✨ Done!\n');
