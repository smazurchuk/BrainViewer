import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  VolumeData,
  WorldCoord,
  SurfaceMesh,
  ColormapType,
  ViewerOverlaySettings,
  FiduciaryMarker
} from '../neuro/types';
import { worldToVoxel, voxelToWorld } from '../neuro/matrixUtils';
import { extractSliceContours, findNearestSliceContourHit } from '../neuro/surfaceUtils';
import {
  Sliders,
  Crosshair as CrosshairIcon,
  ChevronLeft,
  ChevronRight,
  Layers,
  RotateCcw,
  Check,
  Eye,
  EyeOff
} from 'lucide-react';

export function applyColormap(valNorm: number, cmap: ColormapType): [number, number, number] {
  const v = Math.max(0, Math.min(1, valNorm));
  switch (cmap) {
    case 'inverted': {
      const inv = Math.round((1 - v) * 255);
      return [inv, inv, inv];
    }
    case 'hot': {
      let r = 0, g = 0, b = 0;
      if (v <= 0.33) {
        r = (v / 0.33) * 255;
      } else if (v <= 0.66) {
        r = 255;
        g = ((v - 0.33) / 0.33) * 255;
      } else {
        r = 255;
        g = 255;
        b = ((v - 0.66) / 0.34) * 255;
      }
      return [Math.round(r), Math.round(g), Math.round(b)];
    }
    case 'bone': {
      const base = v * 255;
      return [
        Math.min(255, Math.round(base * 0.85)),
        Math.min(255, Math.round(base * 0.95)),
        Math.min(255, Math.round(base * 1.15))
      ];
    }
    case 'jet': {
      const fourV = 4 * v;
      const r = Math.min(Math.max(1.5 - Math.abs(fourV - 3), 0), 1) * 255;
      const g = Math.min(Math.max(1.5 - Math.abs(fourV - 2), 0), 1) * 255;
      const b = Math.min(Math.max(1.5 - Math.abs(fourV - 1), 0), 1) * 255;
      return [Math.round(r), Math.round(g), Math.round(b)];
    }
    case 'coolwarm': {
      let r = 0, g = 0, b = 0;
      if (v < 0.5) {
        const t = v * 2;
        r = Math.round(t * 220);
        g = Math.round(t * 220);
        b = 255;
      } else {
        const t = (v - 0.5) * 2;
        r = 255;
        g = Math.round((1 - t) * 220);
        b = Math.round((1 - t) * 220);
      }
      return [r, g, b];
    }
    case 'grayscale':
    default: {
      const g = Math.round(v * 255);
      return [g, g, g];
    }
  }
}

export interface OrthogonalSliceProps {
  volume: VolumeData;
  plane: 'axial' | 'coronal' | 'sagittal';
  title: string;
  subLabel: string;
  currentSliceIdx: number;
  maxSliceIdx: number;
  onSliceIndexChange: (newIdx: number) => void;
  showStandaloneSettings?: boolean;
  curI: number;
  curJ: number;
  curK: number;
  surfaces?: SurfaceMesh[];
  fiduciaryMarker?: FiduciaryMarker | null;
  onSliceClicked: (mni: WorldCoord, source: 'axial' | 'coronal' | 'sagittal') => void;
  onSurfaceContourDoubleClicked?: (hitCoord: WorldCoord, surf: SurfaceMesh, hemi: 'left' | 'right') => void;
  showCrosshairs: boolean;
  drawContours: boolean;
  showOrientationLabels: boolean;
  colormap: ColormapType;
  windowWidth: number;
  windowLevel: number;

  updateSettings: (updater: (prev: ViewerOverlaySettings) => ViewerOverlaySettings) => void;
}

export const OrthogonalSlice: React.FC<OrthogonalSliceProps> = ({
  volume,
  plane,
  title,
  subLabel,
  currentSliceIdx,
  maxSliceIdx,
  onSliceIndexChange,
  showStandaloneSettings = false,
  curI,
  curJ,
  curK,
  surfaces = [],
  fiduciaryMarker,
  onSliceClicked,
  onSurfaceContourDoubleClicked,
  showCrosshairs,
  drawContours,
  showOrientationLabels,
  colormap,
  windowWidth,
  windowLevel,

  updateSettings
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgDataRef = useRef<ImageData | null>(null);

  const [isMouseDown, setIsMouseDown] = useState<boolean>(false);
  const [localSettingsOpen, setLocalSettingsOpen] = useState<boolean>(false);
  const [feedbackToast, setFeedbackToast] = useState<{ text: string; type: 'success' | 'hint' } | null>(null);

  // Right-click windowing (DICOM-style): track drag origin and accumulated delta
  const rightDragRef = useRef<{ startX: number; startY: number; startWidth: number; startLevel: number } | null>(null);
  const [windowingActive, setWindowingActive] = useState<boolean>(false);

  useEffect(() => {
    if (feedbackToast) {
      const timer = setTimeout(() => setFeedbackToast(null), 3200);
      return () => clearTimeout(timer);
    }
  }, [feedbackToast]);

  const [nx, ny, nz] = volume.dims;
  let width = 0;
  let height = 0;
  if (plane === 'axial') {
    width = nx;
    height = ny;
  } else if (plane === 'coronal') {
    width = nx;
    height = nz;
  } else {
    // Sagittal: X is J (anterior-posterior, ny), Y is K (superior-inferior, nz)
    width = ny;
    height = nz;
  }

  // Precompute radiological flip condition
  const worldAtI0 = useMemo(() => voxelToWorld({ i: 0, j: curJ, k: curK }, volume.affine), [curJ, curK, volume.affine]);
  const worldAtIMax = useMemo(() => voxelToWorld({ i: nx - 1, j: curJ, k: curK }, volume.affine), [nx, curJ, curK, volume.affine]);
  const i0IsPatientRight = worldAtI0.x > worldAtIMax.x;
  // Always use radiological convention (R-L)
  const isRadiological = true;
  const flipX = (plane === 'axial' || plane === 'coronal') ? (isRadiological ? !i0IsPatientRight : i0IsPatientRight) : false;

  // Build high-speed 256-entry Uint32 LUT for colormap + windowing
  const lut32 = useMemo(() => {
    const lut = new Uint32Array(256);
    const minW = windowLevel - windowWidth / 2;
    const range = windowWidth || 1;

    for (let v = 0; v < 256; v++) {
      const norm = (v - minW) / range;
      const [r, g, b] = applyColormap(norm, colormap);
      // Little-endian RGBA: ABGR order in 32-bit integer
      lut[v] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    return lut;
  }, [windowLevel, windowWidth, colormap]);

  // Main Canvas Render Effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      imgDataRef.current = null;
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    if (!imgDataRef.current || imgDataRef.current.width !== width || imgDataRef.current.height !== height) {
      imgDataRef.current = ctx.createImageData(width, height);
    }

    const imgData = imgDataRef.current;
    const buf32 = new Uint32Array(imgData.data.buffer);
    const raw = volume.data;
    const isUint8 = raw instanceof Uint8Array;
    const minW = windowLevel - windowWidth / 2;
    const range = windowWidth || 1;

    let p = 0;

    if (plane === 'axial') {
      const k = Math.max(0, Math.min(nz - 1, currentSliceIdx));
      const kOffset = k * nx * ny;

      for (let j = ny - 1; j >= 0; j--) {
        const rowOffset = kOffset + j * nx;
        if (flipX) {
          for (let i = nx - 1; i >= 0; i--) {
            if (isUint8) {
              buf32[p++] = lut32[raw[rowOffset + i]];
            } else {
              const val = raw[rowOffset + i];
              const [r, g, b] = applyColormap((val - minW) / range, colormap);
              buf32[p++] = (255 << 24) | (b << 16) | (g << 8) | r;
            }
          }
        } else {
          for (let i = 0; i < nx; i++) {
            if (isUint8) {
              buf32[p++] = lut32[raw[rowOffset + i]];
            } else {
              const val = raw[rowOffset + i];
              const [r, g, b] = applyColormap((val - minW) / range, colormap);
              buf32[p++] = (255 << 24) | (b << 16) | (g << 8) | r;
            }
          }
        }
      }
    } else if (plane === 'coronal') {
      const j = Math.max(0, Math.min(ny - 1, currentSliceIdx));
      const jOffset = j * nx;
      const planeStride = nx * ny;

      for (let k = nz - 1; k >= 0; k--) {
        const rowOffset = k * planeStride + jOffset;
        if (flipX) {
          for (let i = nx - 1; i >= 0; i--) {
            if (isUint8) {
              buf32[p++] = lut32[raw[rowOffset + i]];
            } else {
              const val = raw[rowOffset + i];
              const [r, g, b] = applyColormap((val - minW) / range, colormap);
              buf32[p++] = (255 << 24) | (b << 16) | (g << 8) | r;
            }
          }
        } else {
          for (let i = 0; i < nx; i++) {
            if (isUint8) {
              buf32[p++] = lut32[raw[rowOffset + i]];
            } else {
              const val = raw[rowOffset + i];
              const [r, g, b] = applyColormap((val - minW) / range, colormap);
              buf32[p++] = (255 << 24) | (b << 16) | (g << 8) | r;
            }
          }
        }
      }
    } else {
      // Sagittal
      const i = Math.max(0, Math.min(nx - 1, currentSliceIdx));
      const planeStride = nx * ny;

      for (let k = nz - 1; k >= 0; k--) {
        const kOffset = k * planeStride + i;
        for (let j = 0; j < ny; j++) {
          if (isUint8) {
            buf32[p++] = lut32[raw[kOffset + j * nx]];
          } else {
            const val = raw[kOffset + j * nx];
            const [r, g, b] = applyColormap((val - minW) / range, colormap);
            buf32[p++] = (255 << 24) | (b << 16) | (g << 8) | r;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Draw Cortical Surface Contours
    if (drawContours && surfaces && surfaces.length > 0) {
      ctx.save();
      ctx.lineWidth = 1.2;

      let planeCoord = 0;
      if (plane === 'axial') {
        planeCoord = voxelToWorld({ i: 0, j: 0, k: currentSliceIdx }, volume.affine).z;
      } else if (plane === 'coronal') {
        planeCoord = voxelToWorld({ i: 0, j: currentSliceIdx, k: 0 }, volume.affine).y;
      } else {
        planeCoord = voxelToWorld({ i: currentSliceIdx, j: 0, k: 0 }, volume.affine).x;
      }

      surfaces.forEach((surf) => {
        ctx.strokeStyle =
          surf.hemi === 'left' ? 'rgba(56, 189, 248, 0.9)' : 'rgba(244, 63, 94, 0.9)';

        const contourSegments = extractSliceContours(surf, plane, planeCoord);
        if (!contourSegments || contourSegments.length === 0) return;

        ctx.beginPath();
        for (let s = 0; s < contourSegments.length; s++) {
          const seg = contourSegments[s];
          let px1 = 0, py1 = 0, px2 = 0, py2 = 0;

          if (plane === 'axial') {
            const v1 = worldToVoxel({ x: seg.p1[0], y: seg.p1[1], z: planeCoord }, volume.invAffine);
            const v2 = worldToVoxel({ x: seg.p2[0], y: seg.p2[1], z: planeCoord }, volume.invAffine);
            px1 = flipX ? nx - 1 - v1.i : v1.i;
            py1 = ny - 1 - v1.j;
            px2 = flipX ? nx - 1 - v2.i : v2.i;
            py2 = ny - 1 - v2.j;
          } else if (plane === 'coronal') {
            const v1 = worldToVoxel({ x: seg.p1[0], y: planeCoord, z: seg.p1[1] }, volume.invAffine);
            const v2 = worldToVoxel({ x: seg.p2[0], y: planeCoord, z: seg.p2[1] }, volume.invAffine);
            px1 = flipX ? nx - 1 - v1.i : v1.i;
            py1 = nz - 1 - v1.k;
            px2 = flipX ? nx - 1 - v2.i : v2.i;
            py2 = nz - 1 - v2.k;
          } else {
            const v1 = worldToVoxel({ x: planeCoord, y: seg.p1[0], z: seg.p1[1] }, volume.invAffine);
            const v2 = worldToVoxel({ x: planeCoord, y: seg.p2[0], z: seg.p2[1] }, volume.invAffine);
            px1 = v1.j;
            py1 = nz - 1 - v1.k;
            px2 = v2.j;
            py2 = nz - 1 - v2.k;
          }

          ctx.moveTo(px1, py1);
          ctx.lineTo(px2, py2);
        }
        ctx.stroke();
      });
      ctx.restore();
    }

    // Draw Crosshairs
    if (showCrosshairs) {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.85)'; // cyan-400
      ctx.setLineDash([3, 2]);

      let chX = 0;
      let chY = 0;

      if (plane === 'axial') {
        chX = flipX ? nx - 1 - curI : curI;
        chY = ny - 1 - curJ;
      } else if (plane === 'coronal') {
        chX = flipX ? nx - 1 - curI : curI;
        chY = nz - 1 - curK;
      } else {
        chX = curJ;
        chY = nz - 1 - curK;
      }

      // Horizontal crosshair line
      ctx.beginPath();
      ctx.moveTo(0, chY);
      ctx.lineTo(width, chY);
      ctx.stroke();

      // Vertical crosshair line
      ctx.beginPath();
      ctx.moveTo(chX, 0);
      ctx.lineTo(chX, height);
      ctx.stroke();

      // Target center circle
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.95)'; // rose-500
      ctx.beginPath();
      ctx.arc(chX, chY, 3.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }

    // Draw Fiducial Marker if nearby
    if (fiduciaryMarker && fiduciaryMarker.coord) {
      const fVoxel = worldToVoxel(fiduciaryMarker.coord, volume.invAffine);
      let isNearSlice = false;
      let fmX = 0;
      let fmY = 0;

      if (plane === 'axial') {
        isNearSlice = Math.abs(fVoxel.k - currentSliceIdx) <= 2;
        fmX = flipX ? nx - 1 - fVoxel.i : fVoxel.i;
        fmY = ny - 1 - fVoxel.j;
      } else if (plane === 'coronal') {
        isNearSlice = Math.abs(fVoxel.j - currentSliceIdx) <= 2;
        fmX = flipX ? nx - 1 - fVoxel.i : fVoxel.i;
        fmY = nz - 1 - fVoxel.k;
      } else {
        isNearSlice = Math.abs(fVoxel.i - currentSliceIdx) <= 2;
        fmX = fVoxel.j;
        fmY = nz - 1 - fVoxel.k;
      }

      if (isNearSlice) {
        ctx.save();
        ctx.strokeStyle = '#FACC15'; // yellow-400
        ctx.fillStyle = '#FACC15';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(fmX, fmY, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(fmX, fmY, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }, [
    volume,
    plane,
    currentSliceIdx,
    curI,
    curJ,
    curK,
    flipX,
    lut32,
    windowLevel,
    windowWidth,
    colormap,
    drawContours,
    showCrosshairs,
    surfaces,
    fiduciaryMarker,
    width,
    height,
    nx,
    ny,
    nz
  ]);

  // Convert canvas click/drag to MNI World Coord
  // Accounts for object-contain letterboxing: the rendered content is centered
  // within the element with padding on one axis
  const getVoxelAndWorldFromEvent = useCallback((e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    // Compute the actual rendered content area within the element (object-contain scaling)
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    const scale = Math.min(scaleX, scaleY);
    const renderedW = canvas.width * scale;
    const renderedH = canvas.height * scale;
    const offsetX = (rect.width - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;

    // Mouse position relative to the rendered content (not the element)
    const contentX = e.clientX - rect.left - offsetX;
    const contentY = e.clientY - rect.top - offsetY;

    const normX = Math.max(0, Math.min(1, contentX / renderedW));
    const normY = Math.max(0, Math.min(1, contentY / renderedH));

    const clickX = Math.min(width - 1, Math.max(0, Math.floor(normX * width)));
    const clickY = Math.min(height - 1, Math.max(0, Math.floor(normY * height)));

    let targetVoxel: { i: number; j: number; k: number };
    if (plane === 'axial') {
      const i = flipX ? nx - 1 - clickX : clickX;
      const j = ny - 1 - clickY;
      targetVoxel = { i, j, k: currentSliceIdx };
    } else if (plane === 'coronal') {
      const i = flipX ? nx - 1 - clickX : clickX;
      const k = nz - 1 - clickY;
      targetVoxel = { i, j: currentSliceIdx, k };
    } else {
      const j = clickX;
      const k = nz - 1 - clickY;
      targetVoxel = { i: currentSliceIdx, j, k };
    }
    return voxelToWorld(targetVoxel, volume.affine);
  }, [width, height, plane, flipX, nx, ny, nz, currentSliceIdx, volume.affine]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0) {
      setIsMouseDown(true);
      const worldPt = getVoxelAndWorldFromEvent(e);
      if (worldPt) onSliceClicked(worldPt, plane);
    } else if (e.button === 2) {
      handleMouseDownRight(e);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isMouseDown && e.buttons === 1) {
      const worldPt = getVoxelAndWorldFromEvent(e);
      if (worldPt) onSliceClicked(worldPt, plane);
    } else if (e.buttons === 2 && rightDragRef.current) {
      handleMouseMoveWindowing(e);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0) setIsMouseDown(false);
    else if (e.button === 2) handleMouseUpRight(e);
  };

  // DICOM-style right-button windowing
  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault(); // Suppress browser menu; drag is handled via mousedown/mousemove
  };

  const handleMouseDownRight = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 2) return;
    e.preventDefault();
    rightDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: windowWidth,
      startLevel: windowLevel
    };
    setWindowingActive(true);
  };

  const handleMouseMoveWindowing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rightDragRef.current) return;
    const { startX, startY, startWidth, startLevel } = rightDragRef.current;
    // Standard DICOM viewer convention:
    // Horizontal drag → Window Width (contrast): right increases, left decreases
    // Vertical drag → Window Level (brightness): up increases, down decreases
    // Sensitivity scaled to volume range for intuitive feel
    const range = volume.maxVal - volume.minVal || 255;
    const widthSensitivity = range / 300;
    const levelSensitivity = range / 400;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newWidth = Math.max(1, Math.min(range * 2, startWidth + dx * widthSensitivity));
    const newLevel = Math.max(volume.minVal, Math.min(volume.maxVal, startLevel - dy * levelSensitivity));
    updateSettings((prev) => ({ ...prev, windowLevel: newLevel, windowWidth: newWidth }));
  };

  const handleMouseUpRight = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 2) return;
    rightDragRef.current = null;
    setWindowingActive(false);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const worldPt = getVoxelAndWorldFromEvent(e);
    if (!worldPt) return;

    let planeCoord = 0;
    if (plane === 'axial') planeCoord = voxelToWorld({ i: 0, j: 0, k: currentSliceIdx }, volume.affine).z;
    else if (plane === 'coronal') planeCoord = voxelToWorld({ i: 0, j: currentSliceIdx, k: 0 }, volume.affine).y;
    else planeCoord = voxelToWorld({ i: currentSliceIdx, j: 0, k: 0 }, volume.affine).x;

    const hitResult = findNearestSliceContourHit(worldPt, plane, planeCoord, surfaces, 4.5);
    if (hitResult) {
      if (onSurfaceContourDoubleClicked) onSurfaceContourDoubleClicked(hitResult.hitCoord, hitResult.surf, hitResult.hemi);
      onSliceClicked(hitResult.hitCoord, plane);
      setFeedbackToast({ text: `Fiducial marker placed on ${hitResult.hemi.toUpperCase()} contour`, type: 'success' });
    } else {
      onSliceClicked(worldPt, plane);
      setFeedbackToast({ text: 'Double-click on a surface contour to snap fiducial marker', type: 'hint' });
    }
  };

  // Wheel listener for smooth slice navigation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheelEvent = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const dy = e.deltaY;
      if (Math.abs(dy) < 0.2) return;

      const delta = dy > 0 ? -1 : 1;
      const nextIdx = Math.max(0, Math.min(maxSliceIdx, currentSliceIdx + delta));
      if (nextIdx !== currentSliceIdx) {
        onSliceIndexChange(nextIdx);
        let updatedVoxel: { i: number; j: number; k: number };
        if (plane === 'axial') updatedVoxel = { i: curI, j: curJ, k: nextIdx };
        else if (plane === 'coronal') updatedVoxel = { i: curI, j: nextIdx, k: curK };
        else updatedVoxel = { i: nextIdx, j: curJ, k: curK };
        onSliceClicked(voxelToWorld(updatedVoxel, volume.affine), plane);
      }
    };

    el.addEventListener('wheel', handleWheelEvent, { passive: false });
    return () => el.removeEventListener('wheel', handleWheelEvent);
  }, [maxSliceIdx, currentSliceIdx, onSliceIndexChange, plane, curI, curJ, curK, volume.affine, onSliceClicked]);

  const stepSlice = (delta: number) => {
    const nextIdx = Math.max(0, Math.min(maxSliceIdx, currentSliceIdx + delta));
    if (nextIdx !== currentSliceIdx) {
      onSliceIndexChange(nextIdx);
      let updatedVoxel: { i: number; j: number; k: number };
      if (plane === 'axial') updatedVoxel = { i: curI, j: curJ, k: nextIdx };
      else if (plane === 'coronal') updatedVoxel = { i: curI, j: nextIdx, k: curK };
      else updatedVoxel = { i: nextIdx, j: curJ, k: curK };
      onSliceClicked(voxelToWorld(updatedVoxel, volume.affine), plane);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#000000] flex items-center justify-center select-none overflow-hidden group"
    >
      {/* 2D Slice Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: windowingActive ? 'col-resize' : undefined }}
      />

      {/* Floating HUD Badge */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-[#09090B]/90 backdrop-blur border border-[#27272A] px-2 py-1 rounded text-xs pointer-events-auto shadow-md">
        <span className="text-[10px] font-bold text-[#38BDF8] tracking-wider uppercase">
          {title}
        </span>
        <span className="text-[#A1A1AA] font-mono text-[11px] border-l border-[#27272A] pl-1.5">
          {subLabel}
        </span>

        {/* Stepper Buttons */}
        <div className="flex items-center gap-0.5 ml-1 border-l border-[#27272A] pl-1">
          <button
            type="button"
            title="Previous Slice (Wheel Up / Left Arrow)"
            onClick={() => stepSlice(-1)}
            className="p-0.5 hover:bg-[#18181B] text-[#A1A1AA] hover:text-white rounded transition-colors"
          >
            <ChevronLeft size={13} />
          </button>
          <span className="text-[10px] font-mono text-[#71717A] px-0.5 min-w-[28px] text-center">
            {currentSliceIdx}/{maxSliceIdx}
          </span>
          <button
            type="button"
            title="Next Slice (Wheel Down / Right Arrow)"
            onClick={() => stepSlice(1)}
            className="p-0.5 hover:bg-[#18181B] text-[#A1A1AA] hover:text-white rounded transition-colors"
          >
            <ChevronRight size={13} />
          </button>
        </div>

        {/* Quick Settings Icon */}
        {showStandaloneSettings && (
          <button
            type="button"
            title="Overlay & Contrast Settings"
            onClick={() => setLocalSettingsOpen(!localSettingsOpen)}
            className={`p-0.5 ml-1 rounded transition-colors ${
              localSettingsOpen
                ? 'bg-[#38BDF8]/20 text-[#38BDF8]'
                : 'hover:bg-[#18181B] text-[#71717A] hover:text-[#E4E4E7]'
            }`}
          >
            <Sliders size={12} />
          </button>
        )}
      </div>

      {/* Orientation Labels */}
      {showOrientationLabels && (
        <>
          <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-neutral-400/80 pointer-events-none select-none drop-shadow">
            {plane === 'axial' ? 'A' : 'S'}
          </div>
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-neutral-400/80 pointer-events-none select-none drop-shadow">
            {plane === 'axial' ? 'P' : 'I'}
          </div>
          <div className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-neutral-400/80 pointer-events-none select-none drop-shadow">
            {plane === 'sagittal' ? 'P' : flipX ? 'L' : 'R'}
          </div>
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-neutral-400/80 pointer-events-none select-none drop-shadow">
            {plane === 'sagittal' ? 'A' : flipX ? 'R' : 'L'}
          </div>
        </>
      )}

      {/* Standalone Settings Popover */}
      {localSettingsOpen && (
        <div
          className="absolute top-10 left-2 z-20 w-64 bg-[#09090B]/95 backdrop-blur-md border border-[#27272A] rounded-lg p-3 shadow-2xl text-xs flex flex-col gap-2.5 text-[#E4E4E7]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-[#27272A]">
            <span className="font-semibold text-[#38BDF8] text-[11px] uppercase tracking-wider">
              {title} Overlay & Window
            </span>
            <button
              type="button"
              onClick={() => setLocalSettingsOpen(false)}
              className="text-[#71717A] hover:text-white"
            >
              ✕
            </button>
          </div>

          {/* Window Width (Contrast) */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-[#A1A1AA]">
              <span>Window Width (Contrast)</span>
              <span className="font-mono text-[#38BDF8]">{Math.round(windowWidth)}</span>
            </div>
            <input
              type="range"
              min={1}
              max={Math.max(255, volume.maxVal - volume.minVal || 255)}
              value={windowWidth}
              onChange={(e) => {
                const val = Number(e.target.value);
                updateSettings((prev) => ({ ...prev, windowWidth: val }));
              }}
              className="w-full accent-[#38BDF8] h-1.5 bg-[#27272A] rounded-lg cursor-pointer"
            />
          </div>

          {/* Window Level (Brightness) */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-[#A1A1AA]">
              <span>Window Level (Brightness)</span>
              <span className="font-mono text-[#38BDF8]">{Math.round(windowLevel)}</span>
            </div>
            <input
              type="range"
              min={volume.minVal || 0}
              max={volume.maxVal || 255}
              value={windowLevel}
              onChange={(e) => {
                const val = Number(e.target.value);
                updateSettings((prev) => ({ ...prev, windowLevel: val }));
              }}
              className="w-full accent-[#38BDF8] h-1.5 bg-[#27272A] rounded-lg cursor-pointer"
            />
          </div>

          {/* Colormap Selector */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-[#A1A1AA]">Colormap</span>
            <select
              value={colormap}
              onChange={(e) => {
                const cmap = e.target.value as ColormapType;
                updateSettings((prev) => ({ ...prev, colormap: cmap }));
              }}
              className="bg-[#18181B] border border-[#27272A] text-[#E4E4E7] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#38BDF8]"
            >
              <option value="grayscale">Grayscale</option>
              <option value="inverted">Inverted Grayscale</option>
              <option value="hot">Hot Metal</option>
              <option value="bone">Bone</option>
              <option value="jet">Jet / Rainbow</option>
              <option value="coolwarm">Coolwarm (Diverging)</option>
            </select>
          </div>

          {/* Toggle Switches */}
          <div className="flex flex-col gap-1.5 pt-1 border-t border-[#27272A]">
            <button
              type="button"
              onClick={() => updateSettings((prev) => ({ ...prev, showCrosshairs: !prev.showCrosshairs }))}
              className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-[#18181B] transition-colors"
            >
              <span className="text-[11px]">Show Crosshairs</span>
              {showCrosshairs ? <Check size={14} className="text-[#38BDF8]" /> : <span className="text-[#52525B] text-[10px]">Off</span>}
            </button>

            <button
              type="button"
              onClick={() => updateSettings((prev) => ({ ...prev, showSurfaceContours: !prev.showSurfaceContours }))}
              className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-[#18181B] transition-colors"
            >
              <span className="text-[11px]">Surface Contours</span>
              {drawContours ? <Check size={14} className="text-[#38BDF8]" /> : <span className="text-[#52525B] text-[10px]">Off</span>}
            </button>

            <button
              type="button"
              onClick={() => updateSettings((prev) => ({ ...prev, showOrientationLabels: !prev.showOrientationLabels }))}
              className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-[#18181B] transition-colors"
            >
              <span className="text-[11px]">Orientation Labels</span>
              {showOrientationLabels ? <Check size={14} className="text-[#38BDF8]" /> : <span className="text-[#52525B] text-[10px]">Off</span>}
            </button>
          </div>

          {/* Reset Defaults */}
          <button
            type="button"
            onClick={() => {
              updateSettings((prev) => ({
                ...prev,
                windowWidth: volume.maxVal - volume.minVal || 100,
                windowLevel: (volume.maxVal + volume.minVal) / 2 || 50,
                colormap: 'grayscale',
                showCrosshairs: true,
                showSurfaceContours: true,
                showOrientationLabels: true
              }));
            }}
            className="flex items-center justify-center gap-1.5 py-1 px-2 bg-[#18181B] hover:bg-[#27272A] text-[#A1A1AA] hover:text-white rounded transition-colors text-[11px] mt-1"
          >
            <RotateCcw size={12} />
            <span>Reset Window & Overlays</span>
          </button>
        </div>
      )}


      {/* Toast Feedback */}
      {feedbackToast && (
        <div
          className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full text-xs font-medium shadow-xl backdrop-blur-md border transition-all ${
            feedbackToast.type === 'success'
              ? 'bg-[#10B981]/20 text-[#34D399] border-[#10B981]/40'
              : 'bg-[#09090B]/90 text-[#38BDF8] border-[#38BDF8]/40'
          }`}
        >
          {feedbackToast.text}
        </div>
      )}

      {/* Right-click hint — shown subtly when not dragging */}
      {!windowingActive && (
        <div className="absolute bottom-1.5 right-2 z-10 text-[9px] font-mono text-[#3F3F46] pointer-events-none select-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          right-drag: W/L
        </div>
      )}
    </div>
  );
};
