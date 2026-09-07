import { SurfaceMesh, WorldCoord } from './types';

export interface NearestSurfaceResult {
  nearestPoint: WorldCoord;
  distance: number;
  vertexIndex: number;
  hemi: 'left' | 'right';
}

export function findNearestSurfaceVertex(
  coord: WorldCoord,
  surfaces: SurfaceMesh[]
): NearestSurfaceResult | null {
  if (!surfaces || surfaces.length === 0) return null;

  let bestDistSq = Infinity;
  let bestX = 0, bestY = 0, bestZ = 0;
  let bestIdx = 0;
  let bestHemi: 'left' | 'right' = 'left';

  for (const surf of surfaces) {
    const verts = surf.vertices;
    const n = verts.length / 3;

    for (let i = 0; i < n; i++) {
      const vx = verts[i * 3];
      const vy = verts[i * 3 + 1];
      const vz = verts[i * 3 + 2];

      const dx = vx - coord.x;
      const dy = vy - coord.y;
      const dz = vz - coord.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestX = vx;
        bestY = vy;
        bestZ = vz;
        bestIdx = i;
        bestHemi = surf.hemi;
      }
    }
  }

  if (bestDistSq === Infinity) return null;

  return {
    nearestPoint: { x: bestX, y: bestY, z: bestZ },
    distance: Math.sqrt(bestDistSq),
    vertexIndex: bestIdx,
    hemi: bestHemi
  };
}

// Slice contour extraction: extracts 2D segments of surface triangles intersecting a plane
export interface SliceContourSegment {
  p1: [number, number]; // 2D in slice coords
  p2: [number, number];
}

interface FastFaceBounds {
  axial: Float32Array; // [minZ, maxZ, minZ, maxZ, ...]
  coronal: Float32Array; // [minY, maxY, ...]
  sagittal: Float32Array; // [minX, maxX, ...]
}

const boundsMap = new WeakMap<SurfaceMesh, FastFaceBounds>();
const contourCacheMap = new WeakMap<SurfaceMesh, Map<string, SliceContourSegment[]>>();

function getOrCreateFaceBounds(surf: SurfaceMesh): FastFaceBounds {
  let cached = boundsMap.get(surf);
  if (!cached) {
    const faces = surf.faces;
    const verts = surf.vertices;
    const numFaces = faces.length / 3;
    const axial = new Float32Array(numFaces * 2);
    const coronal = new Float32Array(numFaces * 2);
    const sagittal = new Float32Array(numFaces * 2);

    for (let f = 0; f < numFaces; f++) {
      const i1 = faces[f * 3] * 3;
      const i2 = faces[f * 3 + 1] * 3;
      const i3 = faces[f * 3 + 2] * 3;

      const x1 = verts[i1], y1 = verts[i1 + 1], z1 = verts[i1 + 2];
      const x2 = verts[i2], y2 = verts[i2 + 1], z2 = verts[i2 + 2];
      const x3 = verts[i3], y3 = verts[i3 + 1], z3 = verts[i3 + 2];

      const f2 = f * 2;
      axial[f2] = Math.min(z1, z2, z3);
      axial[f2 + 1] = Math.max(z1, z2, z3);

      coronal[f2] = Math.min(y1, y2, y3);
      coronal[f2 + 1] = Math.max(y1, y2, y3);

      sagittal[f2] = Math.min(x1, x2, x3);
      sagittal[f2 + 1] = Math.max(x1, x2, x3);
    }
    cached = { axial, coronal, sagittal };
    boundsMap.set(surf, cached);
  }
  return cached;
}

export function extractSliceContours(
  surf: SurfaceMesh,
  plane: 'axial' | 'coronal' | 'sagittal',
  planeCoord: number
): SliceContourSegment[] {
  let cache = contourCacheMap.get(surf);
  if (!cache) {
    cache = new Map();
    contourCacheMap.set(surf, cache);
  }
  const key = `${plane}_${Math.round(planeCoord * 10)}`;
  const cachedHit = cache.get(key);
  if (cachedHit) {
    return cachedHit;
  }

  const segments: SliceContourSegment[] = [];
  const verts = surf.vertices;
  const faces = surf.faces;
  const numFaces = faces.length / 3;

  const bounds = getOrCreateFaceBounds(surf);
  const planeBounds = plane === 'axial' ? bounds.axial : plane === 'coronal' ? bounds.coronal : bounds.sagittal;

  for (let f = 0; f < numFaces; f++) {
    const f2 = f * 2;
    // Instantly skip faces that do not span planeCoord
    if (planeCoord < planeBounds[f2] || planeCoord > planeBounds[f2 + 1]) {
      continue;
    }

    const i1 = faces[f * 3];
    const i2 = faces[f * 3 + 1];
    const i3 = faces[f * 3 + 2];

    const v1x = verts[i1 * 3], v1y = verts[i1 * 3 + 1], v1z = verts[i1 * 3 + 2];
    const v2x = verts[i2 * 3], v2y = verts[i2 * 3 + 1], v2z = verts[i2 * 3 + 2];
    const v3x = verts[i3 * 3], v3y = verts[i3 * 3 + 1], v3z = verts[i3 * 3 + 2];

    let d1 = 0, d2 = 0, d3 = 0;
    if (plane === 'axial') {
      d1 = v1z - planeCoord;
      d2 = v2z - planeCoord;
      d3 = v3z - planeCoord;
    } else if (plane === 'coronal') {
      d1 = v1y - planeCoord;
      d2 = v2y - planeCoord;
      d3 = v3y - planeCoord;
    } else {
      d1 = v1x - planeCoord;
      d2 = v2x - planeCoord;
      d3 = v3x - planeCoord;
    }

    // Check if triangle intersects plane
    if ((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0)) continue;

    // Edge intersection helper
    const intersectEdge = (va: [number, number, number], vb: [number, number, number], da: number, db: number): [number, number] | null => {
      if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) return null;
      const t = da / (da - db);
      const px = va[0] + t * (vb[0] - va[0]);
      const py = va[1] + t * (vb[1] - va[1]);
      const pz = va[2] + t * (vb[2] - va[2]);

      if (plane === 'axial') return [px, py];
      if (plane === 'coronal') return [px, pz];
      return [py, pz];
    };

    const pts: Array<[number, number]> = [];
    const p12 = intersectEdge([v1x, v1y, v1z], [v2x, v2y, v2z], d1, d2);
    if (p12) pts.push(p12);
    const p23 = intersectEdge([v2x, v2y, v2z], [v3x, v3y, v3z], d2, d3);
    if (p23) pts.push(p23);
    const p31 = intersectEdge([v3x, v3y, v3z], [v1x, v1y, v1z], d3, d1);
    if (p31) pts.push(p31);

    if (pts.length >= 2) {
      segments.push({ p1: pts[0], p2: pts[1] });
    }
  }

  // Prevent memory growth during continuous scrolling
  if (cache.size > 80) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }

  cache.set(key, segments);
  return segments;
}

export interface ContourHitResult {
  hitCoord: WorldCoord;
  distanceMm: number;
  hemi: 'left' | 'right';
  surf: SurfaceMesh;
}

/**
 * Checks if a 2D/3D slice click hits near an extracted cortical surface contour in the current plane.
 * maxDistMm defines the snapping tolerance (default 4.5mm in MNI space).
 */
export function findNearestSliceContourHit(
  clickWorld: WorldCoord,
  plane: 'axial' | 'coronal' | 'sagittal',
  planeCoord: number,
  surfaces: SurfaceMesh[],
  maxDistMm: number = 4.5
): ContourHitResult | null {
  if (!surfaces || surfaces.length === 0) return null;

  let clickU = 0;
  let clickV = 0;
  if (plane === 'axial') {
    clickU = clickWorld.x;
    clickV = clickWorld.y;
  } else if (plane === 'coronal') {
    clickU = clickWorld.x;
    clickV = clickWorld.z;
  } else {
    // sagittal
    clickU = clickWorld.y;
    clickV = clickWorld.z;
  }

  let bestDistSq = Infinity;
  let bestU = clickU;
  let bestV = clickV;
  let bestSurf: SurfaceMesh | null = null;

  for (const surf of surfaces) {
    const segments = extractSliceContours(surf, plane, planeCoord);
    if (!segments || segments.length === 0) continue;

    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      const x1 = seg.p1[0], y1 = seg.p1[1];
      const x2 = seg.p2[0], y2 = seg.p2[1];

      const dx = x2 - x1;
      const dy = y2 - y1;
      const l2 = dx * dx + dy * dy;
      let t = 0;
      if (l2 > 1e-6) {
        t = ((clickU - x1) * dx + (clickV - y1) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
      }
      const cx = x1 + t * dx;
      const cy = y1 + t * dy;
      const dsq = (clickU - cx) * (clickU - cx) + (clickV - cy) * (clickV - cy);

      if (dsq < bestDistSq) {
        bestDistSq = dsq;
        bestU = cx;
        bestV = cy;
        bestSurf = surf;
      }
    }
  }

  if (!bestSurf || bestDistSq > maxDistMm * maxDistMm) {
    return null;
  }

  let hitCoord: WorldCoord;
  if (plane === 'axial') {
    hitCoord = { x: bestU, y: bestV, z: planeCoord };
  } else if (plane === 'coronal') {
    hitCoord = { x: bestU, y: planeCoord, z: bestV };
  } else {
    hitCoord = { x: planeCoord, y: bestU, z: bestV };
  }

  return {
    hitCoord,
    distanceMm: Math.sqrt(bestDistSq),
    hemi: bestSurf.hemi,
    surf: bestSurf
  };
}

