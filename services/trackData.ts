
import * as THREE from 'three';
import { CarState, Driver, TyreStrategy } from '../types';

// Generate distinct colors for each driver using HSL color space
function getDriverColor(driverNumber: number): string {
  const goldenRatio = 0.618033988749895;
  const hue = ((driverNumber * goldenRatio) % 1) * 360;
  return `hsl(${hue}, 85%, 60%)`;
}

// Mock Data for Drivers
export const DRIVERS: Driver[] = [
  { id: 'ver', name: 'Max Verstappen', shortName: 'VERSTAPPEN', team: 'Red Bull Racing', color: getDriverColor(1) },
  { id: 'nor', name: 'Lando Norris', shortName: 'NORRIS', team: 'McLaren', color: getDriverColor(4) },
  { id: 'lec', name: 'Charles Leclerc', shortName: 'LECLERC', team: 'Ferrari', color: getDriverColor(16) },
  { id: 'ham', name: 'Lewis Hamilton', shortName: 'HAMILTON', team: 'Mercedes', color: getDriverColor(44) },
  { id: 'pia', name: 'Oscar Piastri', shortName: 'PIASTRI', team: 'McLaren', color: getDriverColor(81) },
  { id: 'rus', name: 'George Russell', shortName: 'RUSSELL', team: 'Mercedes', color: getDriverColor(63) },
  { id: 'sai', name: 'Carlos Sainz', shortName: 'SAINZ', team: 'Ferrari', color: getDriverColor(55) },
  { id: 'alo', name: 'Fernando Alonso', shortName: 'ALONSO', team: 'Aston Martin', color: getDriverColor(14) },
];

export const generateTrackCurve = (): THREE.CatmullRomCurve3 => {
  const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(50, 0, 20),
    new THREE.Vector3(80, 0, 10),
    new THREE.Vector3(120, 0, 50),
    new THREE.Vector3(100, 0, 100),
    new THREE.Vector3(60, 0, 90),
    new THREE.Vector3(20, 0, 120),
    new THREE.Vector3(-40, 0, 100),
    new THREE.Vector3(-60, 0, 60),
    new THREE.Vector3(-40, 0, 20),
  ];
  return new THREE.CatmullRomCurve3(points, true);
};

export const TRACK_CURVE = generateTrackCurve();
export const TOTAL_TRACK_LENGTH = TRACK_CURVE.getLength();

const getRandomStrategy = (idx: number): TyreStrategy => {
  const compounds: ('SOFT' | 'MEDIUM' | 'HARD')[] = ['SOFT', 'MEDIUM', 'HARD'];
  const compound = compounds[idx % 3];
  return {
    compound,
    age: Math.floor(Math.random() * 10) + 1,
    condition: 100 - (Math.random() * 15),
  };
};

export const getInitialCarStates = (): CarState[] => {
  return DRIVERS.map((driver, index) => {
    const startProgress = 1.0 - (index * 0.005);
    const point = TRACK_CURVE.getPointAt(startProgress % 1);
    
    return {
      driverId: driver.id,
      // We store plain object to avoid React freezing THREE.Vector3 prototypes
      position: { x: point.x, y: point.y, z: point.z } as any, 
      rotation: 0,
      lap: 1,
      lapProgress: startProgress,
      speed: 0,
      strategy: getRandomStrategy(index),
      nextPitWindow: `Lap ${15 + Math.floor(Math.random() * 5)} - ${20 + Math.floor(Math.random() * 5)}`
    };
  });
};

export const updateCars = (
  currentStates: CarState[],
  deltaTime: number,
  playbackSpeed: number
): CarState[] => {
  // Cap deltaTime to prevent huge jumps when tab is backgrounded
  const cappedDelta = Math.min(deltaTime, 0.1);
  const dt = cappedDelta * playbackSpeed;
  
  return currentStates.map((car, idx) => {
    let currentSpeed = 300;
    const speedVariation = Math.sin(car.lapProgress * Math.PI * 4) * 50;
    const driverSkill = (DRIVERS.length - idx) * 2;
    const noise = Math.sin(Date.now() * 0.001 + idx) * 5; 
    
    const finalSpeedKmh = Math.max(80, currentSpeed + speedVariation + driverSkill + noise);
    const finalSpeedMs = finalSpeedKmh / 3.6;
    
    const distanceTraveled = finalSpeedMs * dt;
    const progressDelta = distanceTraveled / TOTAL_TRACK_LENGTH;
    
    let newProgress = car.lapProgress + progressDelta;
    let newLap = car.lap;
    
    // Handle multiple lap completions at high speeds
    while (newProgress >= 1) {
      newProgress -= 1;
      newLap += 1;
    }
    
    // Safety clamp
    newProgress = Math.max(0, Math.min(newProgress, 0.9999));
    
    const newPosVec = TRACK_CURVE.getPointAt(newProgress);
    const lookAheadPos = TRACK_CURVE.getPointAt((newProgress + 0.01) % 1);
    const direction = new THREE.Vector3().subVectors(lookAheadPos, newPosVec).normalize();
    const yaw = Math.atan2(direction.x, direction.z);
    const newCondition = Math.max(0, car.strategy.condition - (dt * 0.05));

    return {
      ...car,
      position: { x: newPosVec.x, y: newPosVec.y, z: newPosVec.z } as any,
      rotation: yaw,
      lap: newLap,
      lapProgress: newProgress,
      speed: finalSpeedKmh,
      strategy: {
        ...car.strategy,
        condition: newCondition
      }
    };
  });
};
