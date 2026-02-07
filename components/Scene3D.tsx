
/// <reference types="@react-three/fiber" />
import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { Track } from './Track';
import { Car } from './Car';
import { CarState, CameraMode } from '../types';
import { DRIVERS } from '../services/trackData';

interface DriverInfo {
  id: string;
  shortName: string;
  color: string;
}

interface SceneContentProps {
  cars: CarState[];
  cameraMode: CameraMode;
  focusedDriverId: string | null;
  trackPoints?: { x: number; z: number }[];
  realDrivers?: DriverInfo[];
}

const SceneContent: React.FC<SceneContentProps> = ({ cars, cameraMode, focusedDriverId, trackPoints, realDrivers }) => {
  const controlsRef = useRef<any>(null);
  
  // Memoize vectors to avoid constant reallocation in useFrame
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const tempTarget = useMemo(() => new THREE.Vector3(), []);
  
  useFrame((state) => {
    if (!cars || cars.length === 0) return;

    // Camera Animation Logic
    if (cameraMode === CameraMode.FOLLOW && focusedDriverId) {
      const targetCar = cars.find(c => c.driverId === focusedDriverId);
      if (targetCar && targetCar.position) {
        const distance = 12;
        const height = 6;
        
        // Convert plain object back to Vector3 for math
        const carPos = tempVec.set(targetCar.position.x, targetCar.position.y, targetCar.position.z);
        
        const camPos = new THREE.Vector3(
           carPos.x - Math.sin(targetCar.rotation) * distance,
           carPos.y + height,
           carPos.z - Math.cos(targetCar.rotation) * distance
        );

        state.camera.position.lerp(camPos, 0.1);
        state.camera.lookAt(carPos);
        if(controlsRef.current) controlsRef.current.target.lerp(carPos, 0.1);
      }
    } else if (cameraMode === CameraMode.TV_BROADCAST) {
        const hasRealData = !!(trackPoints && trackPoints.length > 0);
        // Safe check for leader
        const scores = cars.map(x => (x.lap || 0) + (x.lapProgress || 0));
        const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
        const leader = cars.find(c => (c.lap || 0) + (c.lapProgress || 0) === maxScore);
        
        const t = state.clock.getElapsedTime() * 0.1;
        const leaderPos = leader && leader.position 
            ? tempVec.set(leader.position.x, leader.position.y, leader.position.z) 
            : tempVec.set(hasRealData ? 0 : 30, 0, hasRealData ? 0 : 60);
        
        // For real data, follow the leader directly; for simulated, blend with scene center
        const targetPos = hasRealData
            ? tempTarget.copy(leaderPos)
            : tempTarget.lerpVectors(new THREE.Vector3(30, 0, 60), leaderPos, 0.5);
        const orbRadius = hasRealData ? 150 : 100;
        const camHeight = hasRealData ? 120 : 80;
        
        state.camera.position.lerp(new THREE.Vector3(
            Math.sin(t) * orbRadius + targetPos.x, 
            camHeight, 
            Math.cos(t) * orbRadius + targetPos.z
        ), 0.05);
        
        state.camera.lookAt(targetPos);
        if(controlsRef.current) {
          controlsRef.current.target.lerp(targetPos, 0.05);
          controlsRef.current.update();
        }
    }
  });

  const is2D = cameraMode === CameraMode.MAP_2D;

  return (
    <>
      {!is2D && <ambientLight intensity={0.8} />}
      {!is2D && <directionalLight position={[50, 100, 50]} intensity={1.5} castShadow />}
      {is2D && <ambientLight intensity={3} />}
      {is2D && <directionalLight position={[0, 100, 0]} intensity={2} />}
      
      {!is2D && <Stars radius={300} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />}
      
      {is2D && (
        <OrthographicCamera 
          makeDefault 
          position={[0, 200, 0]} 
          rotation={[-Math.PI / 2, 0, 0]} 
          zoom={2.5}
          near={0.1}
          far={1000}
        />
      )}

      {!is2D && (
        <PerspectiveCamera
          makeDefault
          position={[0, 80, 80]}
          fov={50}
        />
      )}

      <Track is2D={is2D} trackPoints={trackPoints} />
      
      {is2D && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]}>
            <planeGeometry args={[2000, 2000]} />
            <meshBasicMaterial color="#000000" />
          </mesh>
        </>
      )}
      
      {cars.map((car) => {
        // Try real drivers first, fall back to simulated
        const realDriver = realDrivers?.find(d => d.id === car.driverId);
        const simDriver = DRIVERS.find(d => d.id === car.driverId);
        const driverName = realDriver?.shortName ?? simDriver?.shortName ?? '???';
        const driverColor = realDriver?.color ?? simDriver?.color ?? '#ffffff';
        return (
          <Car
            key={car.driverId}
            position={car.position}
            rotation={car.rotation}
            color={driverColor}
            name={driverName}
            isFocused={car.driverId === focusedDriverId}
            is2D={is2D}
          />
        );
      })}

      {is2D ? (
        <OrbitControls 
            ref={controlsRef}
            enableRotate={false} 
            enableZoom={true} 
            enablePan={true}
            mouseButtons={{
                LEFT: THREE.MOUSE.PAN,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN
            }}
            target={[0, 0, 0]}
        />
      ) : (
        <OrbitControls 
          ref={controlsRef} 
          enabled={cameraMode === CameraMode.TV_BROADCAST || cameraMode === CameraMode.FOLLOW} 
          maxPolarAngle={Math.PI / 2.1} 
        />
      )}
    </>
  );
};

interface Scene3DProps {
  cars: CarState[];
  cameraMode: CameraMode;
  focusedDriverId: string | null;
  trackPoints?: { x: number; z: number }[];
  realDrivers?: DriverInfo[];
}

export const Scene3D: React.FC<Scene3DProps> = (props) => {
  return (
    <div className="w-full h-full bg-slate-900">
      <Canvas shadows gl={{ antialias: true }} camera={{ position: [0, 80, 80], fov: 50 }} style={{ background: props.cameraMode === CameraMode.MAP_2D ? '#000000' : undefined }}>
        <SceneContent {...props} />
      </Canvas>
    </div>
  );
};
