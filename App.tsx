
import React, { useState, useEffect, useCallback } from 'react';
import { Scene3D } from './components/Scene3D';
import { getInitialCarStates, updateCars, DRIVERS } from './services/trackData';
import {
  getRaceIndex, loadRaceData, LoadedRaceData, LoadProgress, RaceInfo,
  getPositionsAtTime, normalizeCoord,
  getDriverLapAtTime, getDriverPositionAtTime, getDriverIntervalAtTime,
} from './services/raceData';
import { CarState, CameraMode, RaceSession } from './types';
import { Play, Pause, Video, Zap, Map as MapIcon, ChevronRight, Trophy, Timer, Settings, Activity, Loader2 } from 'lucide-react';

// Generate distinct colors for each driver using HSL color space
function getDriverColor(driverNumber: number): string {
  const goldenRatio = 0.618033988749895;
  const hue = ((driverNumber * goldenRatio) % 1) * 360;
  return `hsl(${hue}, 85%, 60%)`;
}

export default function App() {
  // Simulated state (fallback)
  const [simCars, setSimCars] = useState<CarState[]>(getInitialCarStates());

  // Data mode: 'simulated' uses fake data, 'real' uses pre-downloaded race data
  const [dataMode, setDataMode] = useState<'simulated' | 'real'>('simulated');
  const [raceData, setRaceData] = useState<LoadedRaceData | null>(null);
  const [isLoadingRace, setIsLoadingRace] = useState(false);
  const [loadProgress, setLoadProgress] = useState<LoadProgress>({ stage: '', percent: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);

  // Available races from local index
  const [raceIndex, setRaceIndex] = useState<RaceInfo[]>([]);

  // Common state
  const [time, setTime] = useState(0);
  const [raceTimeMs, setRaceTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [cameraMode, setCameraMode] = useState<CameraMode>(CameraMode.TV_BROADCAST);
  const [focusedDriverId, setFocusedDriverId] = useState<string | null>(null);
  const [selectedRace, setSelectedRace] = useState<RaceSession>({
    id: 'none', name: 'Select a Race', location: '', totalLaps: 0, date: '',
  });
  const [showRaceSelector, setShowRaceSelector] = useState(false);

  // Real car states derived from raceData
  const [realCars, setRealCars] = useState<CarState[]>([]);
  const [trackPoints, setTrackPoints] = useState<{ x: number; z: number }[]>([]);
  const [realDriversInfo, setRealDriversInfo] = useState<{ id: string; shortName: string; color: string; team: string; fullName: string; number: number }[]>([]);

  const cars = dataMode === 'real' ? realCars : simCars;

  // Load race index on mount
  useEffect(() => {
    getRaceIndex()
      .then(setRaceIndex)
      .catch(err => console.warn('No race index found:', err.message));
  }, []);

  // Simulated game loop
  useEffect(() => {
    if (dataMode !== 'simulated') return;
    let animationFrameId: number;
    let lastTime = performance.now();
    const loop = (now: number) => {
      if (isPlaying) {
        const deltaTime = Math.min((now - lastTime) / 1000, 0.1);
        setSimCars(prev => updateCars(prev, deltaTime, playbackSpeed));
        setTime(prev => prev + deltaTime * playbackSpeed);
      }
      lastTime = now;
      animationFrameId = requestAnimationFrame(loop);
    };
    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, playbackSpeed, dataMode]);

  // Real data playback loop
  useEffect(() => {
    if (dataMode !== 'real' || !raceData) return;
    let animationFrameId: number;
    let lastTime = performance.now();
    const loop = (now: number) => {
      if (isPlaying) {
        const deltaTime = Math.min((now - lastTime) / 1000, 0.1);
        setRaceTimeMs(prev => Math.min(prev + deltaTime * playbackSpeed * 1000, raceData.raceDurationMs));
      }
      lastTime = now;
      animationFrameId = requestAnimationFrame(loop);
    };
    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, playbackSpeed, dataMode, raceData]);

  // Auto-select first driver when playing starts
  useEffect(() => {
    if (isPlaying && !focusedDriverId && cars.length > 0) {
      setFocusedDriverId(cars[0].driverId);
    }
  }, [isPlaying, focusedDriverId, cars]);

  // Derive real car states from raceTimeMs
  useEffect(() => {
    if (dataMode !== 'real' || !raceData) return;
    const positions = getPositionsAtTime(raceTimeMs, raceData);
    const newCars: CarState[] = [];
    // Only render drivers we have info for (limited to 10)
    for (const drv of realDriversInfo) {
      const driverNum = Number(drv.id);
      const pos = positions.get(driverNum);
      if (!pos) continue;
      const normalized = normalizeCoord(pos.x, pos.y, raceData.bounds);
      const lapInfo = getDriverLapAtTime(driverNum, raceTimeMs, raceData);
      newCars.push({
        driverId: drv.id,
        position: { x: normalized.x, y: 0, z: normalized.z } as any,
        rotation: 0,
        lap: lapInfo.lap,
        lapProgress: 0,
        speed: pos.speed,
        strategy: {
          compound: lapInfo.compound as any,
          age: lapInfo.tyreAge,
          condition: Math.max(0, 100 - lapInfo.tyreAge * 3),
        },
        nextPitWindow: '',
      });
    }
    setRealCars(newCars);
  }, [raceTimeMs, raceData, dataMode, realDriversInfo]);

  // Load a pre-downloaded race
  const loadLocalRace = useCallback(async (race: RaceInfo) => {
    setIsLoadingRace(true);
    setLoadError(null);
    setIsPlaying(false);
    setRaceTimeMs(0);
    try {
      const data = await loadRaceData(race.slug, setLoadProgress);
      setRaceData(data);
      setDataMode('real');
      setCameraMode(CameraMode.MAP_2D);

      // Track outline — filter out any remaining zero points
      const validOutline = data.trackOutline.filter(p => p[0] !== 0 || p[1] !== 0);
      const points = validOutline.map(p => normalizeCoord(p[0], p[1], data.bounds));
      setTrackPoints(points);

      // Select 10 drivers with the most position data coverage
      const driverDataCounts: Record<number, number> = {};
      for (const d of data.drivers) driverDataCounts[d.n] = 0;
      const snapLen = data.locationSnapshots.length;
      for (let i = 0; i < snapLen; i += 50) {
        const snapDrivers = data.locationSnapshots[i][1];
        for (const dn of Object.keys(snapDrivers)) {
          const num = Number(dn);
          if (num in driverDataCounts) driverDataCounts[num]++;
        }
      }
      const topDrivers = [...data.drivers]
        .sort((a, b) => (driverDataCounts[b.n] || 0) - (driverDataCounts[a.n] || 0))
        .slice(0, 10);

      // Driver info
      const driverInfos = topDrivers.map(d => ({
        id: String(d.n),
        shortName: d.code,
        color: getDriverColor(d.n),
        team: d.team,
        fullName: d.name,
        number: d.n,
      }));
      setRealDriversInfo(driverInfos);

      setSelectedRace({
        id: race.slug,
        name: race.meeting_name,
        location: race.location,
        totalLaps: data.totalLaps,
        date: race.date_start?.split('T')[0] ?? '',
      });
      setFocusedDriverId(null);
      setShowRaceSelector(false);
    } catch (err: any) {
      console.error('Failed to load race data:', err);
      setLoadError(err.message || 'Failed to load race data');
    } finally {
      setIsLoadingRace(false);
    }
  }, []);

  const switchToSimulated = useCallback(() => {
    setDataMode('simulated');
    setRaceData(null);
    setRealCars([]);
    setTrackPoints([]);
    setRealDriversInfo([]);
    setTime(0);
    setSimCars(getInitialCarStates());
    setIsPlaying(false);
    setSelectedRace({ id: 'sim', name: 'Simulated GP', location: 'Monaco', totalLaps: 78, date: '2025-01-01' });
    setFocusedDriverId(null);
    setShowRaceSelector(false);
  }, []);

  const getLeaderboard = () => {
    if (!cars || cars.length === 0) return [];
    if (dataMode === 'real' && raceData) {
      return cars
        .map(car => {
          const driverNum = Number(car.driverId);
          const pos = getDriverPositionAtTime(driverNum, raceTimeMs, raceData);
          const intervalInfo = getDriverIntervalAtTime(driverNum, raceTimeMs, raceData);
          const drvInfo = realDriversInfo.find(d => d.id === car.driverId);
          return {
            ...car,
            driver: drvInfo ? { id: drvInfo.id, name: drvInfo.fullName, shortName: drvInfo.shortName, team: drvInfo.team, color: drvInfo.color } : null,
            position: pos,
            gap: intervalInfo.gap,
            interval: intervalInfo.interval,
          };
        })
        .sort((a, b) => a.position - b.position);
    }
    return [...cars]
      .sort((a, b) => ((b.lap || 0) + (b.lapProgress || 0)) - ((a.lap || 0) + (a.lapProgress || 0)))
      .map((car, idx) => {
        const driver = DRIVERS.find(d => d.id === car.driverId);
        return { ...car, driver, position: idx + 1, gap: '', interval: '' };
      });
  };

  const leaderboard = getLeaderboard();
  const focusedCar = cars.find(c => c.driverId === focusedDriverId);
  const focusedDriverInfo = dataMode === 'real'
    ? realDriversInfo.find(d => d.id === focusedDriverId)
    : DRIVERS.find(d => d.id === focusedDriverId);
  const focusedCarPos = leaderboard.find(l => l.driverId === focusedDriverId)?.position || '-';
  const displayTime = dataMode === 'real' ? raceTimeMs / 1000 : time;
  const currentLap = dataMode === 'real' && realCars.length > 0
    ? Math.max(...realCars.map(c => c.lap))
    : (simCars[0] ? Math.floor(simCars[0].lap) : 0);

  return (
    <div className="flex w-full h-screen bg-black overflow-hidden relative font-sans text-white">
      <div className="flex-1 relative">
        <Scene3D
          cars={cars}
          cameraMode={cameraMode}
          focusedDriverId={focusedDriverId}
          trackPoints={trackPoints}
          realDrivers={realDriversInfo}
        />

        {/* Top Bar */}
        <div className="absolute top-0 left-0 w-full p-6 bg-gradient-to-b from-black/90 via-black/50 to-transparent pointer-events-none flex justify-between items-start z-10">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black italic tracking-tighter">
                <span className="text-red-600">F1</span> REPLAY
              </h1>
              {dataMode === 'real' && <span className="bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">2025 Season</span>}
              {dataMode === 'simulated' && <span className="bg-yellow-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">Simulated</span>}
            </div>
            <div className="flex items-center gap-2 mt-1 pointer-events-auto">
              <button onClick={() => setShowRaceSelector(true)} className="text-slate-300 hover:text-white hover:bg-white/10 px-2 py-1 -ml-2 rounded flex items-center gap-1 transition-all">
                <span className="text-lg font-bold uppercase">{selectedRace.name}</span>
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="text-slate-400 text-xs font-mono mt-0.5">
              {selectedRace.location} • {selectedRace.date} • LAP {currentLap} / {selectedRace.totalLaps}
            </div>
          </div>
          <div className="text-right">
            <div className="text-5xl font-bold text-white tabular-nums tracking-tight drop-shadow-lg">
              {new Date(displayTime * 1000).toISOString().substr(11, 8)}
            </div>
          </div>
        </div>

        {/* Leaderboard */}
        <div className="absolute top-52 left-6 w-72 bg-black/80 backdrop-blur-md border border-slate-800/50 rounded-xl overflow-hidden pointer-events-auto shadow-2xl z-10">
          <div className="bg-slate-900/80 px-4 py-3 text-xs font-bold text-slate-400 border-b border-slate-700/50 uppercase flex justify-between tracking-wider">
            <span>Pos</span>
            <span>Driver</span>
            <span>Gap</span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
            {leaderboard.map((item) => (
              <div
                key={item.driverId}
                onClick={() => {
                  setFocusedDriverId(item.driverId);
                  if (cameraMode === CameraMode.TV_BROADCAST) setCameraMode(CameraMode.FOLLOW);
                }}
                className={`group flex items-center px-4 py-3 border-b border-slate-800/30 cursor-pointer hover:bg-slate-800 transition-all ${
                  focusedDriverId === item.driverId ? 'bg-slate-800 border-l-4 border-l-red-600 pl-3' : 'border-l-4 border-l-transparent'
                }`}
              >
                <div className="w-8 font-mono text-slate-400 font-bold group-hover:text-white">{item.position}</div>
                <div className="flex items-center flex-1 gap-3">
                  <div className="w-1 h-8 rounded-full" style={{ backgroundColor: item.driver?.color }}></div>
                  <div className="flex flex-col">
                    <span className="font-bold text-white leading-tight">{item.driver?.shortName ?? '???'}</span>
                    <span className="text-[10px] text-slate-500 uppercase">{item.driver?.team ?? ''}</span>
                  </div>
                </div>
                <div className="text-xs text-slate-400 tabular-nums font-mono">
                  {item.position === 1 ? 'LEADER' : dataMode === 'real' && item.gap ? `+${item.gap}` : `+${((item.position - 1) * 0.8).toFixed(3)}`}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Driver Telemetry */}
        {focusedCar && focusedDriverInfo && (
          <div className="absolute top-24 right-6 w-80 bg-black/90 backdrop-blur-xl border border-slate-700 rounded-xl p-0 overflow-hidden shadow-2xl pointer-events-auto z-10">
            <div className="relative h-24 bg-gradient-to-r from-slate-900 to-slate-800 p-4 flex items-end justify-between border-b border-slate-700">
              <div className="absolute top-0 right-0 p-4 opacity-10"><Trophy size={80} /></div>
              <div>
                <h2 className="text-3xl font-black italic">{focusedDriverInfo.shortName}</h2>
                <p className="text-xs text-slate-400 uppercase tracking-widest">{focusedDriverInfo.team}</p>
              </div>
              <div className="text-4xl font-bold text-white/90">P{focusedCarPos}</div>
            </div>
            <div className="p-5 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Activity size={12} /> Speed</div>
                  <div className="text-2xl font-mono font-bold">{focusedCar.speed.toFixed(0)} <span className="text-sm text-slate-500 font-sans font-normal">km/h</span></div>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Timer size={12} /> Lap</div>
                  <div className="text-2xl font-mono font-bold">{focusedCar.lap}</div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400 tracking-wider"><Settings size={14} /> Strategy</div>
                <div className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/50 flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full border-4 flex items-center justify-center text-[10px] font-bold bg-slate-900 ${
                    focusedCar.strategy.compound === 'SOFT' ? 'border-red-500 text-red-500' :
                    focusedCar.strategy.compound === 'MEDIUM' ? 'border-yellow-500 text-yellow-500' :
                    focusedCar.strategy.compound === 'HARD' ? 'border-white text-white' :
                    'border-green-500 text-green-500'
                  }`}>{focusedCar.strategy.compound[0]}</div>
                  <div>
                    <div className="text-sm font-bold capitalize">{focusedCar.strategy.compound.toLowerCase()}</div>
                    <div className="text-xs text-slate-400">{focusedCar.strategy.age} Laps Old</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-slate-900/80 p-3 border-t border-slate-700 text-center">
              <button onClick={() => setFocusedDriverId(null)} className="text-xs text-slate-400 hover:text-white uppercase font-bold tracking-widest transition-colors">Close</button>
            </div>
          </div>
        )}

        {/* Playback Controls */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-xl px-8 py-4 rounded-2xl border border-slate-700/50 flex items-center gap-8 pointer-events-auto shadow-2xl z-10">
          <button onClick={() => setIsPlaying(!isPlaying)} className="hover:text-red-500 transition-colors transform hover:scale-110">
            {isPlaying ? <Pause fill="currentColor" size={28} /> : <Play fill="currentColor" size={28} />}
          </button>
          <div className="h-8 w-px bg-slate-700"></div>
          <div className="flex gap-2">
            {[1, 4, 16, 64].map(speed => (
              <button key={speed} onClick={() => setPlaybackSpeed(speed)} className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${playbackSpeed === speed ? 'bg-white text-black scale-105' : 'hover:bg-slate-800 text-slate-400'}`}>{speed}x</button>
            ))}
          </div>
          <div className="h-8 w-px bg-slate-700"></div>
          <div className="flex gap-6 text-slate-400">
            <button onClick={() => setCameraMode(CameraMode.MAP_2D)} className={`hover:text-white transition-all flex flex-col items-center gap-1 ${cameraMode === CameraMode.MAP_2D ? 'text-red-500 scale-110' : ''}`} title="2D Map">
              <MapIcon size={20} /><span className="text-[9px] uppercase font-bold tracking-wider">Map</span>
            </button>
            {dataMode === 'simulated' && (
              <>
                <button onClick={() => setCameraMode(CameraMode.TV_BROADCAST)} className={`hover:text-white transition-all flex flex-col items-center gap-1 ${cameraMode === CameraMode.TV_BROADCAST ? 'text-red-500 scale-110' : ''}`} title="TV Broadcast">
                  <Zap size={20} /><span className="text-[9px] uppercase font-bold tracking-wider">TV</span>
                </button>
                <button onClick={() => { setCameraMode(CameraMode.FOLLOW); if (!focusedDriverId && cars.length > 0) setFocusedDriverId(cars[0].driverId); }} className={`hover:text-white transition-all flex flex-col items-center gap-1 ${cameraMode === CameraMode.FOLLOW ? 'text-red-500 scale-110' : ''}`} title="Follow Cam">
                  <Video size={20} /><span className="text-[9px] uppercase font-bold tracking-wider">Onboard</span>
                </button>
              </>
            )}
          </div>
          {dataMode === 'real' && raceData && (
            <>
              <div className="h-8 w-px bg-slate-700"></div>
              <div className="flex flex-col gap-1 w-56">
                <input type="range" min={0} max={raceData.raceDurationMs} value={raceTimeMs} onChange={(e) => setRaceTimeMs(Number(e.target.value))} className="w-full h-1 accent-red-600 cursor-pointer" />
                <div className="text-[9px] text-slate-500 text-center font-mono">
                  {Math.floor(raceTimeMs / 60000)}:{String(Math.floor((raceTimeMs % 60000) / 1000)).padStart(2, '0')} / {Math.floor(raceData.raceDurationMs / 60000)}:{String(Math.floor((raceData.raceDurationMs % 60000) / 1000)).padStart(2, '0')}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Race Selector */}
        {showRaceSelector && (
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden">
              <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                <h2 className="text-2xl font-bold italic">SELECT RACE — 2025 SEASON</h2>
                <button onClick={() => setShowRaceSelector(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
              </div>
              <div className="flex border-b border-slate-700">
                <button className="flex-1 p-3 text-sm font-bold uppercase tracking-wider bg-green-600/20 text-green-400 border-b-2 border-green-400">
                  2025 Season Races
                </button>
                <button onClick={switchToSimulated} className="flex-1 p-3 text-sm font-bold uppercase tracking-wider text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all">Simulated Demo</button>
              </div>
              <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                {isLoadingRace && (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <Loader2 className="animate-spin text-green-400" size={40} />
                    <div className="text-lg font-bold">{loadProgress.stage}</div>
                    <div className="w-64 bg-slate-800 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full transition-all duration-300" style={{ width: `${loadProgress.percent}%` }} />
                    </div>
                    <div className="text-sm text-slate-400">{loadProgress.percent.toFixed(0)}%</div>
                  </div>
                )}
                {loadError && (
                  <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-4">
                    <div className="text-red-400 font-bold">Error loading race</div>
                    <div className="text-red-300 text-sm mt-1">{loadError}</div>
                  </div>
                )}
                {!isLoadingRace && (
                  <div className="grid gap-3">
                    {raceIndex.length > 0 ? raceIndex.map(race => (
                      <button
                        key={race.slug}
                        onClick={() => loadLocalRace(race)}
                        className="text-left p-4 rounded-xl border bg-slate-800 border-slate-700 hover:border-green-500 hover:bg-slate-750 transition-all flex items-center justify-between group"
                      >
                        <div>
                          <div className="text-lg font-bold">{race.meeting_name}</div>
                          <div className="text-sm text-slate-400">
                            {race.circuit_short_name} • {race.location} • {race.date_start?.split('T')[0]}
                            {race.totalLaps ? ` • ${race.totalLaps} laps` : ''}
                          </div>
                        </div>
                        <ChevronRight className="opacity-0 group-hover:opacity-100 transition-opacity text-green-400" />
                      </button>
                    )) : (
                      <div className="text-center py-12 text-slate-500">
                        <div className="text-lg font-bold mb-2">No race data found</div>
                        <div className="text-sm">Run <code className="bg-slate-800 px-2 py-1 rounded">node scripts/download-races.mjs</code> to download 2025 season data</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {isLoadingRace && !showRaceSelector && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-40 flex flex-col items-center justify-center gap-4">
            <Loader2 className="animate-spin text-green-400" size={48} />
            <div className="text-xl font-bold">{loadProgress.stage}</div>
            <div className="w-80 bg-slate-800 rounded-full h-2">
              <div className="bg-green-500 h-2 rounded-full transition-all duration-300" style={{ width: `${loadProgress.percent}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
