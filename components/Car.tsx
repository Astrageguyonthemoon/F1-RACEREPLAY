
/// <reference types="@react-three/fiber" />
import React from 'react';

interface CarProps {
  position: { x: number; y: number; z: number };
  rotation: number;
  color: string;
  name: string;
  isFocused: boolean;
  is2D: boolean;
}

export const Car: React.FC<CarProps> = ({ position, rotation, color, name, isFocused, is2D }) => {
  // Convert plain object to array for R3F props to ensure stability
  const posArray: [number, number, number] = [position.x, position.y, position.z];
  
  if (is2D) {
    return (
      <group position={[position.x, 2, position.z]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.5, 32]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    );
  }

  return (
    <group position={posArray} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1, 0.6, 4]} />
        <meshStandardMaterial color={color} roughness={0.3} metalness={0.7} />
      </mesh>
      
      <mesh position={[0, 0.2, 1.8]}>
        <boxGeometry args={[2.5, 0.1, 0.8]} />
        <meshStandardMaterial color="#222" />
      </mesh>

      <mesh position={[0, 1.2, -1.8]}>
        <boxGeometry args={[2.0, 0.4, 0.6]} />
        <meshStandardMaterial color="#222" />
      </mesh>

      <mesh position={[1, 0.4, 1.5]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.4, 0.4, 0.6, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh position={[-1, 0.4, 1.5]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.4, 0.4, 0.6, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh position={[1, 0.4, -1.5]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.4, 0.4, 0.6, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh position={[-1, 0.4, -1.5]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.4, 0.4, 0.6, 16]} />
        <meshStandardMaterial color="#111" />
      </mesh>
    </group>
  );
};
