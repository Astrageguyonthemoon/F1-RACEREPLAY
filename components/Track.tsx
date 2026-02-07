
/// <reference types="@react-three/fiber" />
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { TRACK_CURVE } from '../services/trackData';

interface TrackProps {
  is2D?: boolean;
  // Real track outline points (normalized to scene space) for 2D mode
  trackPoints?: { x: number; z: number }[];
}

export const Track: React.FC<TrackProps> = ({ is2D = false, trackPoints }) => {
  // Shared curve: real track data when available, simulated fallback
  const { curve, isRealTrack } = useMemo(() => {
    if (trackPoints && trackPoints.length >= 10) {
      const pts = trackPoints.map(p => new THREE.Vector3(p.x, 0, p.z));
      return { curve: new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5), isRealTrack: true };
    }
    return { curve: TRACK_CURVE, isRealTrack: false };
  }, [trackPoints]);

  // --- 2D Track: Two parallel mesh ribbons forming track boundary ---
  const track2D = useMemo(() => {
    if (!is2D) return null;

    const POINTS_COUNT = 500;
    const TRACK_HALF_WIDTH = isRealTrack ? 1.5 : 2.5;
    const LINE_WIDTH = isRealTrack ? 0.5 : 1.0;

    const sampledPoints = curve.getPoints(POINTS_COUNT);

    // Build a flat ribbon mesh along the track at a given offset
    const buildRibbon = (offset: number): THREE.BufferGeometry => {
      const vertices: number[] = [];
      const indices: number[] = [];

      for (let i = 0; i < sampledPoints.length; i++) {
        const p = sampledPoints[i];
        const nextIdx = (i + 1) % sampledPoints.length;
        const prevIdx = (i - 1 + sampledPoints.length) % sampledPoints.length;

        // Tangent direction in XZ plane
        const tx = sampledPoints[nextIdx].x - sampledPoints[prevIdx].x;
        const tz = sampledPoints[nextIdx].z - sampledPoints[prevIdx].z;
        const len = Math.sqrt(tx * tx + tz * tz) || 1;

        // Perpendicular in XZ plane (rotate 90°)
        const px = -tz / len;
        const pz = tx / len;

        // Inner and outer edges of the ribbon
        const innerX = p.x + px * offset;
        const innerZ = p.z + pz * offset;
        const sign = offset > 0 ? 1 : -1;
        const outerX = p.x + px * (offset + LINE_WIDTH * sign);
        const outerZ = p.z + pz * (offset + LINE_WIDTH * sign);

        vertices.push(innerX, 1, innerZ);  // even vertex
        vertices.push(outerX, 1, outerZ);  // odd vertex

        if (i < sampledPoints.length - 1) {
          const base = i * 2;
          indices.push(base, base + 2, base + 1);
          indices.push(base + 1, base + 2, base + 3);
        }
      }

      // Close the loop: connect last segment to first
      const last = (sampledPoints.length - 1) * 2;
      indices.push(last, 0, last + 1);
      indices.push(last + 1, 0, 1);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    };

    const leftGeo = buildRibbon(TRACK_HALF_WIDTH);
    const rightGeo = buildRibbon(-TRACK_HALF_WIDTH);

    return { leftGeo, rightGeo };
  }, [is2D, curve, isRealTrack]);

  // --- 3D Track: Original extruded road with edge lines ---
  const track3D = useMemo(() => {
    if (is2D) return null;

    const TRACK_WIDTH = isRealTrack ? 4 : 14;
    const POINTS_COUNT = isRealTrack ? 500 : 800;

    const shape = new THREE.Shape();
    shape.moveTo(-TRACK_WIDTH / 2, 0);
    shape.lineTo(TRACK_WIDTH / 2, 0);
    shape.lineTo(TRACK_WIDTH / 2, 0.1);
    shape.lineTo(-TRACK_WIDTH / 2, 0.1);

    const roadGeometry = new THREE.ExtrudeGeometry(shape, {
      extrudePath: curve,
      steps: POINTS_COUNT,
      bevelEnabled: false,
    });

    const points = curve.getPoints(POINTS_COUNT);
    const frames = curve.computeFrenetFrames(POINTS_COUNT, true);

    const lineWidth = isRealTrack ? 0.4 : 0.8;
    const halfWidth = TRACK_WIDTH / 2;

    const buildStrip = (offsetScalar: number) => {
      const vertices: number[] = [];
      const indices: number[] = [];

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const normal = frames.normals[i];
        const inner = p.clone().add(normal.clone().multiplyScalar(offsetScalar));
        const outerOffset = offsetScalar > 0 ? offsetScalar + lineWidth : offsetScalar - lineWidth;
        const outer = p.clone().add(normal.clone().multiplyScalar(outerOffset));
        vertices.push(inner.x, inner.y + 0.15, inner.z);
        vertices.push(outer.x, outer.y + 0.15, outer.z);

        if (i < points.length - 1) {
          const base = i * 2;
          indices.push(base, base + 1, base + 2);
          indices.push(base + 1, base + 3, base + 2);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    };

    const leftLineGeometry = buildStrip(halfWidth);
    const rightLineGeometry = buildStrip(-halfWidth);

    return { roadGeometry, leftLineGeometry, rightLineGeometry };
  }, [is2D, curve, isRealTrack]);

  // --- Render ---

  if (is2D && track2D) {
    return (
      <group>
        <mesh geometry={track2D.leftGeo}>
          <meshBasicMaterial color="#CCCCCC" side={THREE.DoubleSide} />
        </mesh>
        <mesh geometry={track2D.rightGeo}>
          <meshBasicMaterial color="#CCCCCC" side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }

  if (!is2D && track3D) {
    return (
      <group>
        <mesh geometry={track3D.roadGeometry} position={[0, -0.1, 0]} receiveShadow>
          <meshStandardMaterial color="#FFFFFF" emissive="#222222" roughness={0.6} metalness={0.1} />
        </mesh>
        <mesh geometry={track3D.leftLineGeometry}>
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <mesh geometry={track3D.rightLineGeometry}>
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <gridHelper args={[1000, 100, 0x333333, 0x111111]} position={[0, -2, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.1, 0]}>
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial color="#050a14" />
        </mesh>
      </group>
    );
  }

  return null;
};
