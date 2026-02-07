import { Vector3 } from 'three';

export interface Driver {
  id: string;
  name: string;
  team: string;
  color: string;
  shortName: string;
}

export interface TyreStrategy {
  compound: 'SOFT' | 'MEDIUM' | 'HARD' | 'INTER' | 'WET';
  age: number;
  condition: number; // 0-100%
}

export interface CarState {
  driverId: string;
  position: Vector3;
  rotation: number; // Y-axis rotation (yaw) in radians
  lap: number;
  lapProgress: number; // 0 to 1
  speed: number; // km/h
  strategy: TyreStrategy;
  nextPitWindow: string;
}

export interface RaceSession {
  id: string;
  name: string;
  location: string;
  totalLaps: number;
  date: string;
}

export enum CameraMode {
  TV_BROADCAST = 'TV_BROADCAST',
  FOLLOW = 'FOLLOW',
  MAP_2D = 'MAP_2D',
}