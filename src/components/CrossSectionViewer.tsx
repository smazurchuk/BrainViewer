import React, { useEffect, useRef, useState } from 'react';
import { VolumeData, WorldCoord, SurfaceMesh, ColormapType, ViewerOverlaySettings, FitMode, FiduciaryMarker } from '../neuro/types';
import { worldToVoxel, voxelToWorld } from '../neuro/matrixUtils';
import { extractSliceContours, findNearestSliceContourHit } from '../neuro/surfaceUtils';
import {
  Sliders,
  Crosshair as CrosshairIcon,
  ChevronLeft,
  ChevronRight,
  Layers,
  RotateCcw,
  Move,
  MapPin
} from 'lucide-react';

export interface CrossSectionViewerProps {
  volume: VolumeData;
  crosshair: WorldCoord;
  surfaces?: SurfaceMesh[];
  fiduciaryMarker?: FiduciaryMarker | null;
  onSliceClicked: (mni: WorldCoord, source: 'axial' | 'coronal' | 'sagittal') => void;
  onSurfaceContourDoubleClicked?: (hitCoord: WorldCoord, surf: SurfaceMesh, hemi: 'left' | 'right') => void;
  showSurfaceContours?: boolean;
  activePlaneFocus?: 'all' | 'axial' | 'coronal' | 'sagittal';
  overlaySettings?: ViewerOverlaySettings;
  onOverlaySettingsChange?: (updater: (prev: ViewerOverlaySettings) => ViewerOverlaySettings) => void;
  onContextMenu?: (e: React.MouseEvent, plane: 'axial' | 'coronal' | 'sagittal', coord: WorldCoord) => void;
}

// Colormap generator
function applyColormap(valNorm: number, cmap: ColormapType): [number, number, number] {
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
      return [r, g, b];
    }
    case 'bone': {
      const base = v * 255;
      return [Math.min(255, base * 0.85), Math.min(255, base * 0.95), Math.min(255, base * 1.15)];
    }
    case 'jet': {
      const fourV = 4 * v;
      const r = Math.min(Math.max(1.5 - Math.abs(fourV - 3), 0), 1) * 255;
      const g = Math.min(Math.max(1.5 - Math.abs(fourV - 2), 0), 1) * 255;
      const b = Math.min(Math.max(1.5 - Math.abs(fourV - 1), 0), 1) * 255;
      return [r, g, b];
    }
    case 'grayscale':
    default: {
      const g = Math.round(v * 255);
      return [g, g, g];
    }
  }
}

export const CrossSectionViewer: React.FC<CrossSectionViewerProps> = ({
  volume,
  crosshair,
  surfaces = [],
  fiduciaryMarker,
  onSliceClicked,
  onSurfaceContourDoubleClicked,
  showSurfaceContours = true,
  activePlaneFocus = 'all',
  overlaySettings,
  onOverlaySettingsChange,
  onContextMenu
}) => {
  // Local fallback if synchronized settings aren't provided by parent
  const [localSettings, setLocalSettings] = useState<ViewerOverlaySettings>({
    showCrosshairs: true,
    showSurfaceContours: showSurfaceContours,
    showOrientationLabels: true,
    colormap: 'grayscale',
    windowWidth: volume.maxVal - volume.minVal || 100,
    windowLevel: (volume.maxVal + volume.minVal) / 2 || 50,
    fitMode: 'fit', // Default to Zoom to Fit
    zoomLevel: 1.0
  });

  const settings = overlaySettings || localSettings;
  const updateSettings = onOverlaySettingsChange || setLocalSettings;

  const {
    showCrosshairs,
    showSurfaceContours: drawContours,
    showOrientationLabels,
    colormap,
    windowWidth,
    windowLevel,
    fitMode = 'fit',
    zoomLevel = 1.0
  } = settings;

  // Convert current MNI world coordinate to volume voxel indices
  const currentVoxel = worldToVoxel(crosshair, volume.invAffine);
  const [nx, ny, nz] = volume.dims;

  // Clamped voxel indices
  const curI = Math.max(0, Math.min(nx - 1, currentVoxel.i));
  const curJ = Math.max(0, Math.min(ny - 1, currentVoxel.j));
  const curK = Math.max(0, Math.min(nz - 1, currentVoxel.k));

  // Local slice positions per plane - decoupled from crosshair so scrolling does not trigger heavy computations
  const [axialSlice, setAxialSlice] = useState<number>(curK);
  const [coronalSlice, setCoronalSlice] = useState<number>(curJ);
  const [sagittalSlice, setSagittalSlice] = useState<number>(curI);

  // Sync slice positions only when crosshair coordinate actually changes
  useEffect(() => {
    setAxialSlice(curK);
  }, [curK]);

  useEffect(() => {
    setCoronalSlice(curJ);
  }, [curJ]);

  useEffect(() => {
    setSagittalSlice(curI);
  }, [curI]);

  // World coordinates of currently displayed slices
  const axialWorldZ = voxelToWorld({ i: curI, j: curJ, k: axialSlice }, volume.affine).z;
  const coronalWorldY = voxelToWorld({ i: curI, j: coronalSlice, k: curK }, volume.affine).y;
  const sagittalWorldX = voxelToWorld({ i: sagittalSlice, j: curJ, k: curK }, volume.affine).x;

  // Single Orthogonal Plane Canvas Component
  const OrthogonalSlice: React.FC<{
    plane: 'axial' | 'coronal' | 'sagittal';
    title: string;
    subLabel: string;
    currentSliceIdx: number;
    maxSliceIdx: number;
    onSliceIndexChange: (newIdx: number) => void;
    showStandaloneSettings?: boolean;
  }> = ({
    plane,
    title,
    subLabel,
    currentSliceIdx,
    maxSliceIdx,
    onSliceIndexChange,
    showStandaloneSettings = false
  }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const imageDataRef = useRef<ImageData | null>(null);
    // Cached base slice canvas (pixels + contours) so orthogonal crosshair movements don't recalculate voxels or contours
    const sliceBaseCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const lastBaseKeyRef = useRef<string>('');

    const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
    const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isMouseDown, setIsMouseDown] = useState<boolean>(false);
    const [localSettingsOpen, setLocalSettingsOpen] = useState<boolean>(false);
    const [feedbackToast, setFeedbackToast] = useState<{ text: string; type: 'success' | 'hint' } | null>(null);

    useEffect(() => {
      if (feedbackToast) {
        const timer = setTimeout(() => setFeedbackToast(null), 3200);
        return () => clearTimeout(timer);
      }
    }, [feedbackToast]);

    // Track wheel accumulation for smooth trackpad scrolling without jumping
    const wheelAccumulatorRef = useRef<number>(0);
    const sliceIdxRef = useRef<number>(currentSliceIdx);
    sliceIdxRef.current = currentSliceIdx;

    const rafIdRef = useRef<number | null>(null);
    const pendingSliceIdxRef = useRef<number | null>(null);

    // Track drag state for distinguishing pan vs click vs context menu
    const dragStartRef = useRef<{ x: number; y: number; button: number } | null>(null);
    const hasMovedRef = useRef<boolean>(false);

    // Responsive container size observer to maximize space utilization
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            setContainerSize((prev) => {
              if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) return prev;
              return { width, height };
            });
          }
        }
      });

      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    let width = 0;
    let height = 0;
    if (plane === 'axial') {
      width = nx;
      height = ny;
    } else if (plane === 'coronal') {
      width = nx;
      height = nz;
    } else {
      // sagittal
      width = ny;
      height = nz;
    }

    // Space utilization calculation: Fit entire slice cleanly within container (Zero wasted space, zero jumping)
    const cw = containerSize.width || 400;
    const ch = containerSize.height || 300;
    const currentScale = Math.min(cw / width, ch / height);
    const renderedWidth = Math.max(10, Math.round(width * currentScale));
    const renderedHeight = Math.max(10, Math.round(height * currentScale));

    // Render the slice onto canvas with crisp pixels and high-res vector overlays
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Only resize canvas if dimensions actually changed to eliminate flicker
      if (canvas.width !== renderedWidth) {
        canvas.width = renderedWidth;
      }
      if (canvas.height !== renderedHeight) {
        canvas.height = renderedHeight;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Base slice cache key: only recompute voxel pixels and contour vectors if slice index, windowing, colormap, or dimensions change
      const baseKey = `${plane}_${currentSliceIdx}_${windowLevel}_${windowWidth}_${colormap}_${drawContours}_${renderedWidth}_${renderedHeight}_${surfaces.length}`;

      if (!sliceBaseCanvasRef.current) {
        sliceBaseCanvasRef.current = document.createElement('canvas');
      }
      const baseCanvas = sliceBaseCanvasRef.current;

      if (
        baseKey !== lastBaseKeyRef.current ||
        baseCanvas.width !== renderedWidth ||
        baseCanvas.height !== renderedHeight
      ) {
        lastBaseKeyRef.current = baseKey;
        if (baseCanvas.width !== renderedWidth) baseCanvas.width = renderedWidth;
        if (baseCanvas.height !== renderedHeight) baseCanvas.height = renderedHeight;

        const baseCtx = baseCanvas.getContext('2d');
        if (!baseCtx) return;

        // 1. Offscreen canvas for voxel image generation at native volume resolution (reused across frames)
        if (!offscreenCanvasRef.current) {
          offscreenCanvasRef.current = document.createElement('canvas');
        }
        const offscreen = offscreenCanvasRef.current;
        if (offscreen.width !== width) offscreen.width = width;
        if (offscreen.height !== height) offscreen.height = height;

        const offCtx = offscreen.getContext('2d');
        if (!offCtx) return;

        if (
          !imageDataRef.current ||
          imageDataRef.current.width !== width ||
          imageDataRef.current.height !== height
        ) {
          imageDataRef.current = offCtx.createImageData(width, height);
        }
        const imgData = imageDataRef.current;

        // Fast 256-entry 32-bit colormap lookup table (LUT)
        const lut32 = new Uint32Array(256);
        for (let c = 0; c < 256; c++) {
          const [r, g, b] = applyColormap(c / 255, colormap);
          lut32[c] = (255 << 24) | (b << 16) | (g << 8) | r;
        }

        const u32 = new Uint32Array(imgData.data.buffer);
        const halfW = windowWidth / 2;
        const minW = windowLevel - halfW;
        const maxW = windowLevel + halfW;
        const range = maxW - minW || 1;
        const invRange = 255 / range;

        // Extract 2D slice buffer with optimized flat indexing
        if (plane === 'axial') {
          const k = Math.max(0, Math.min(nz - 1, currentSliceIdx));
          let pixIdx = 0;
          const kOffset = k * nx * ny;
          for (let j = ny - 1; j >= 0; j--) {
            const rowOffset = j * nx + kOffset;
            for (let i = 0; i < nx; i++) {
              const val = volume.data[rowOffset + i];
              const b = (val - minW) * invRange;
              const idx = b < 0 ? 0 : b > 255 ? 255 : (b | 0);
              u32[pixIdx++] = lut32[idx];
            }
          }
        } else if (plane === 'coronal') {
          const j = Math.max(0, Math.min(ny - 1, currentSliceIdx));
          let pixIdx = 0;
          const jOffset = j * nx;
          for (let k = nz - 1; k >= 0; k--) {
            const sliceOffset = k * nx * ny + jOffset;
            for (let i = 0; i < nx; i++) {
              const val = volume.data[sliceOffset + i];
              const b = (val - minW) * invRange;
              const idx = b < 0 ? 0 : b > 255 ? 255 : (b | 0);
              u32[pixIdx++] = lut32[idx];
            }
          }
        } else {
          // Sagittal
          const i = Math.max(0, Math.min(nx - 1, currentSliceIdx));
          let pixIdx = 0;
          for (let k = nz - 1; k >= 0; k--) {
            const kOffset = k * nx * ny + i;
            for (let j = 0; j < ny; j++) {
              const val = volume.data[kOffset + j * nx];
              const b = (val - minW) * invRange;
              const idx = b < 0 ? 0 : b > 255 ? 255 : (b | 0);
              u32[pixIdx++] = lut32[idx];
            }
          }
        }

        offCtx.putImageData(imgData, 0, 0);

        // 2. Draw scaled slice to base canvas with crisp pixelated interpolation
        baseCtx.imageSmoothingEnabled = false;
        baseCtx.drawImage(offscreen, 0, 0, renderedWidth, renderedHeight);

        // 3. Draw cortical surface contours batched with single stroke call
        if (drawContours && surfaces && surfaces.length > 0) {
          baseCtx.save();
          baseCtx.lineWidth = 1.5;

          let planeCoord = 0;
          if (plane === 'axial') {
            const pt = voxelToWorld({ i: 0, j: 0, k: currentSliceIdx }, volume.affine);
            planeCoord = pt.z;
          } else if (plane === 'coronal') {
            const pt = voxelToWorld({ i: 0, j: currentSliceIdx, k: 0 }, volume.affine);
            planeCoord = pt.y;
          } else {
            const pt = voxelToWorld({ i: currentSliceIdx, j: 0, k: 0 }, volume.affine);
            planeCoord = pt.x;
          }

          surfaces.forEach((surf) => {
            const contourSegments = extractSliceContours(surf, plane, planeCoord);
            if (!contourSegments || contourSegments.length === 0) return;

            baseCtx.strokeStyle =
              surf.hemi === 'left' ? 'rgba(56, 189, 248, 0.85)' : 'rgba(244, 63, 94, 0.85)';

            baseCtx.beginPath();
            const count = contourSegments.length;
            for (let s = 0; s < count; s++) {
              const seg = contourSegments[s];
              let px1 = 0, py1 = 0, px2 = 0, py2 = 0;

              if (plane === 'axial') {
                const v1 = worldToVoxel({ x: seg.p1[0], y: seg.p1[1], z: planeCoord }, volume.invAffine);
                const v2 = worldToVoxel({ x: seg.p2[0], y: seg.p2[1], z: planeCoord }, volume.invAffine);
                px1 = v1.i;
                py1 = ny - 1 - v1.j;
                px2 = v2.i;
                py2 = ny - 1 - v2.j;
              } else if (plane === 'coronal') {
                const v1 = worldToVoxel({ x: seg.p1[0], y: planeCoord, z: seg.p1[1] }, volume.invAffine);
                const v2 = worldToVoxel({ x: seg.p2[0], y: planeCoord, z: seg.p2[1] }, volume.invAffine);
                px1 = v1.i;
                py1 = nz - 1 - v1.k;
                px2 = v2.i;
                py2 = nz - 1 - v2.k;
              } else {
                const v1 = worldToVoxel({ x: planeCoord, y: seg.p1[0], z: seg.p1[1] }, volume.invAffine);
                const v2 = worldToVoxel({ x: planeCoord, y: seg.p2[0], z: seg.p2[1] }, volume.invAffine);
                px1 = v1.j;
                py1 = nz - 1 - v1.k;
                px2 = v2.j;
                py2 = nz - 1 - v2.k;
              }

              const rx1 = (px1 / width) * renderedWidth;
              const ry1 = (py1 / height) * renderedHeight;
              const rx2 = (px2 / width) * renderedWidth;
              const ry2 = (py2 / height) * renderedHeight;

              baseCtx.moveTo(rx1, ry1);
              baseCtx.lineTo(rx2, ry2);
            }
            baseCtx.stroke();
          });
          baseCtx.restore();
        }
      }

      // Blit cached base slice to visible canvas
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(baseCanvas, 0, 0);

      // 4. Draw Synchronized Crosshairs with crisp subpixel rendering
      if (showCrosshairs) {
        ctx.save();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)'; // cyan-400
        ctx.setLineDash([4, 3]);

        let chX = 0;
        let chY = 0;

        if (plane === 'axial') {
          chX = curI;
          chY = ny - 1 - curJ;
        } else if (plane === 'coronal') {
          chX = curI;
          chY = nz - 1 - curK;
        } else {
          chX = curJ;
          chY = nz - 1 - curK;
        }

        const rx = (chX / width) * renderedWidth;
        const ry = (chY / height) * renderedHeight;

        // Horizontal crosshair line
        ctx.beginPath();
        ctx.moveTo(0, ry);
        ctx.lineTo(renderedWidth, ry);
        ctx.stroke();

        // Vertical crosshair line
        ctx.beginPath();
        ctx.moveTo(rx, 0);
        ctx.lineTo(rx, renderedHeight);
        ctx.stroke();

        // Target center reticle circle
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.95)'; // rose-500
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(rx, ry, 4, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
      }

      // 5. Draw Fiduciary Marker if active and within 3 slices of the current plane
      if (fiduciaryMarker) {
        const fVoxel = worldToVoxel(fiduciaryMarker.coord, volume.invAffine);
        let fSliceIdx = 0;
        let fmX = 0;
        let fmY = 0;

        if (plane === 'axial') {
          fSliceIdx = fVoxel.k;
          fmX = fVoxel.i;
          fmY = ny - 1 - fVoxel.j;
        } else if (plane === 'coronal') {
          fSliceIdx = fVoxel.j;
          fmX = fVoxel.i;
          fmY = nz - 1 - fVoxel.k;
        } else {
          // sagittal
          fSliceIdx = fVoxel.i;
          fmX = fVoxel.j;
          fmY = nz - 1 - fVoxel.k;
        }

        const sliceDist = Math.abs(currentSliceIdx - fSliceIdx);
        // Render if within 3 slices (~2.1mm) of the fiduciary plane
        if (sliceDist <= 3) {
          const fx = (fmX / width) * renderedWidth;
          const fy = (fmY / height) * renderedHeight;
          const alpha = sliceDist === 0 ? 1.0 : sliceDist === 1 ? 0.75 : 0.45;

          ctx.save();
          ctx.globalAlpha = alpha;

          // Outer pulsing ring
          ctx.beginPath();
          ctx.arc(fx, fy, 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#F43F5E'; // rose-500
          ctx.lineWidth = 1.8;
          ctx.stroke();

          // Inner ring
          ctx.beginPath();
          ctx.arc(fx, fy, 4, 0, Math.PI * 2);
          ctx.strokeStyle = '#38BDF8'; // sky-400
          ctx.lineWidth = 1.2;
          ctx.stroke();

          // Center solid point
          ctx.beginPath();
          ctx.arc(fx, fy, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();

          // "FIDUCIAL" marker badge label when directly on slice
          if (sliceDist === 0) {
            ctx.font = 'bold 9px monospace';
            const labelText = 'FIDUCIAL';
            const textWidth = ctx.measureText(labelText).width;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(fx + 10, fy - 6, textWidth + 6, 13);
            ctx.strokeStyle = '#F43F5E';
            ctx.lineWidth = 0.8;
            ctx.strokeRect(fx + 10, fy - 6, textWidth + 6, 13);
            ctx.fillStyle = '#FAFAFA';
            ctx.fillText(labelText, fx + 13, fy + 4);
          }

          ctx.restore();
        }
      }
    }, [
      plane,
      currentSliceIdx,
      curI,
      curJ,
      curK,
      windowLevel,
      windowWidth,
      colormap,
      showCrosshairs,
      drawContours,
      surfaces,
      fiduciaryMarker,
      width,
      height,
      renderedWidth,
      renderedHeight
    ]);

    // Precise subpixel mapping from screen mouse event to volume voxel & world coordinate
    const getVoxelAndWorldFromEvent = (e: React.MouseEvent<HTMLCanvasElement> | MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      // Normalized [0, 1] position within the rendered canvas element
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;

      // Clamp safely within valid image range
      const normX = Math.max(0, Math.min(1, relX));
      const normY = Math.max(0, Math.min(1, relY));

      // Map to exact discrete voxel coordinate on the 2D volume plane
      const clickX = Math.min(width - 1, Math.max(0, Math.floor(normX * width)));
      const clickY = Math.min(height - 1, Math.max(0, Math.floor(normY * height)));

      let targetVoxel: { i: number; j: number; k: number };

      if (plane === 'axial') {
        const i = clickX;
        const j = Math.max(0, Math.min(ny - 1, ny - 1 - clickY));
        targetVoxel = { i, j, k: currentSliceIdx };
      } else if (plane === 'coronal') {
        const i = clickX;
        const k = Math.max(0, Math.min(nz - 1, nz - 1 - clickY));
        targetVoxel = { i, j: currentSliceIdx, k };
      } else {
        // Sagittal
        const j = clickX;
        const k = Math.max(0, Math.min(nz - 1, nz - 1 - clickY));
        targetVoxel = { i: currentSliceIdx, j, k };
      }

      return voxelToWorld(targetVoxel, volume.affine);
    };

    // Mouse Down: Start Pan or Crosshair Drag
    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      dragStartRef.current = { x: e.clientX, y: e.clientY, button: e.button };
      hasMovedRef.current = false;

      // Left click without modifier keys -> place crosshair immediately
      if (e.button === 0 && !e.shiftKey && !e.altKey) {
        setIsMouseDown(true);
        const worldPt = getVoxelAndWorldFromEvent(e);
        if (worldPt) onSliceClicked(worldPt, plane);
      }
    };

    // Mouse Move: Handle smooth Pan or Crosshair Drag
    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragStartRef.current) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        if (Math.hypot(dx, dy) > 4) {
          hasMovedRef.current = true;
        }

        // Panning condition: Right-click drag, Middle-click drag, or Shift/Alt + Left-click drag
        const isPanDrag =
          dragStartRef.current.button === 2 ||
          dragStartRef.current.button === 1 ||
          (dragStartRef.current.button === 0 && (e.shiftKey || e.altKey));

        if (isPanDrag) {
          setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
          dragStartRef.current = { x: e.clientX, y: e.clientY, button: dragStartRef.current.button };
          return;
        }
      }

      // Crosshair tracking with left click
      if (isMouseDown && e.buttons === 1 && !e.shiftKey && !e.altKey) {
        const worldPt = getVoxelAndWorldFromEvent(e);
        if (worldPt) onSliceClicked(worldPt, plane);
      }
    };

    // Mouse Up
    const handleMouseUp = () => {
      setIsMouseDown(false);
      dragStartRef.current = null;
    };

    // Context Menu: Only open if user did NOT pan
    const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!hasMovedRef.current) {
        const worldPt = getVoxelAndWorldFromEvent(e);
        if (worldPt && onContextMenu) {
          onContextMenu(e, plane, worldPt);
        }
      }
    };

    // Double-click to place fiduciary marker ONLY on surface contour
    const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const worldPt = getVoxelAndWorldFromEvent(e);
      if (!worldPt) return;

      let planeCoord = 0;
      if (plane === 'axial') {
        const pt = voxelToWorld({ i: 0, j: 0, k: currentSliceIdx }, volume.affine);
        planeCoord = pt.z;
      } else if (plane === 'coronal') {
        const pt = voxelToWorld({ i: 0, j: currentSliceIdx, k: 0 }, volume.affine);
        planeCoord = pt.y;
      } else {
        const pt = voxelToWorld({ i: currentSliceIdx, j: 0, k: 0 }, volume.affine);
        planeCoord = pt.x;
      }

      // Check hit on cortical surface contour in this plane
      const hitResult = findNearestSliceContourHit(worldPt, plane, planeCoord, surfaces, 4.5);

      if (hitResult) {
        if (onSurfaceContourDoubleClicked) {
          onSurfaceContourDoubleClicked(hitResult.hitCoord, hitResult.surf, hitResult.hemi);
        }
        onSliceClicked(hitResult.hitCoord, plane);
        setFeedbackToast({
          text: `Fiducial marker placed on ${hitResult.hemi.toUpperCase()} contour`,
          type: 'success'
        });
      } else {
        // Did not hit a surface contour - navigate slice crosshair without placing fiduciary marker
        onSliceClicked(worldPt, plane);
        setFeedbackToast({
          text: 'Double-click directly on a surface contour (colored lines) to place fiducial marker',
          type: 'hint'
        });
      }
      setPanOffset({ x: 0, y: 0 });
    };

    // Native non-passive wheel listener attached to container element
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const handleWheelEvent = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const dy = e.deltaY;
        if (Math.abs(dy) < 0.2) return;

        let delta = 0;
        if (Math.abs(dy) >= 30) {
          // Discrete mouse wheel click (single notch)
          delta = dy > 0 ? -1 : 1;
          wheelAccumulatorRef.current = 0;
        } else {
          // Continuous trackpad scrolling with momentum tracking
          if (
            (wheelAccumulatorRef.current > 0 && dy < 0) ||
            (wheelAccumulatorRef.current < 0 && dy > 0)
          ) {
            wheelAccumulatorRef.current = 0;
          }

          wheelAccumulatorRef.current += dy;
          const trackpadStep = 15;
          if (Math.abs(wheelAccumulatorRef.current) >= trackpadStep) {
            delta = wheelAccumulatorRef.current > 0 ? -1 : 1;
            wheelAccumulatorRef.current = 0;
          }
        }

        if (delta !== 0) {
          const currentVal =
            pendingSliceIdxRef.current !== null
              ? pendingSliceIdxRef.current
              : sliceIdxRef.current;
          const nextIdx = Math.max(0, Math.min(maxSliceIdx, currentVal + delta));

          if (nextIdx !== currentVal) {
            pendingSliceIdxRef.current = nextIdx;
            sliceIdxRef.current = nextIdx;

            if (rafIdRef.current === null) {
              rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null;
                if (pendingSliceIdxRef.current !== null) {
                  const target = pendingSliceIdxRef.current;
                  pendingSliceIdxRef.current = null;
                  onSliceIndexChange(target);
                }
              });
            }
          }
        }
      };

      el.addEventListener('wheel', handleWheelEvent, { passive: false });
      return () => {
        el.removeEventListener('wheel', handleWheelEvent);
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    }, [maxSliceIdx, onSliceIndexChange]);

    return (
      <div className="relative w-full h-full bg-[#000000] flex flex-col select-none overflow-hidden group">
        {/* Floating Top-Left HUD Badge */}
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 bg-[#09090B]/90 backdrop-blur border border-[#27272A] px-2 py-1 rounded text-xs pointer-events-auto shadow-md">
          <span className="text-[10px] font-bold text-[#38BDF8] tracking-wider uppercase">
            {title}
          </span>
          <span className="text-[#A1A1AA] font-mono text-[11px] border-l border-[#27272A] pl-1.5">
            {subLabel}
          </span>

          {/* Stepper buttons */}
          <div className="flex items-center gap-0.5 ml-1 border-l border-[#27272A] pl-1">
            <button
              type="button"
              title="Previous Slice"
              onClick={() => {
                const n = Math.max(0, currentSliceIdx - 1);
                onSliceIndexChange(n);
              }}
              className="p-0.5 hover:bg-[#18181B] text-[#A1A1AA] hover:text-white rounded transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[10px] text-[#FAFAFA] px-1">
              {currentSliceIdx}
            </span>
            <button
              type="button"
              title="Next Slice"
              onClick={() => {
                const n = Math.min(maxSliceIdx, currentSliceIdx + 1);
                onSliceIndexChange(n);
              }}
              className="p-0.5 hover:bg-[#18181B] text-[#A1A1AA] hover:text-white rounded transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Floating Top-Right Controls Badge */}
        {showStandaloneSettings && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-[#09090B]/90 backdrop-blur border border-[#27272A] p-1 rounded text-xs pointer-events-auto shadow-md">
            {/* Reset Pan button if panned */}
            {(panOffset.x !== 0 || panOffset.y !== 0) && (
              <button
                type="button"
                title="Reset Pan to Center"
                onClick={() => {
                  setPanOffset({ x: 0, y: 0 });
                }}
                className="px-1.5 py-0.5 hover:bg-[#18181B] text-[#38BDF8] rounded transition-colors flex items-center gap-1 text-[10px]"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="text-[9px]">Center</span>
              </button>
            )}

            {/* Crosshairs toggle */}
            <button
              type="button"
              title="Toggle Crosshairs (Synchronized across all views)"
              onClick={() => updateSettings((prev) => ({ ...prev, showCrosshairs: !prev.showCrosshairs }))}
              className={`p-1 rounded transition-colors ${
                showCrosshairs ? 'bg-[#38BDF8]/20 text-[#38BDF8]' : 'text-[#71717A] hover:text-white'
              }`}
            >
              <CrosshairIcon className="w-3.5 h-3.5" />
            </button>

            {/* Cortical Contours toggle */}
            <button
              type="button"
              title="Toggle Surface Contours (Synchronized across all views)"
              onClick={() => updateSettings((prev) => ({ ...prev, showSurfaceContours: !prev.showSurfaceContours }))}
              className={`p-1 rounded transition-colors ${
                drawContours ? 'bg-[#38BDF8]/20 text-[#38BDF8]' : 'text-[#71717A] hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
            </button>

            {/* Sliders popover toggle */}
            <button
              type="button"
              title="Adjust Contrast & Color (Synchronized)"
              onClick={() => setLocalSettingsOpen(!localSettingsOpen)}
              className={`p-1 rounded transition-colors ${
                localSettingsOpen ? 'bg-[#38BDF8] text-black' : 'text-[#71717A] hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Synchronized Settings Popover */}
        {showStandaloneSettings && localSettingsOpen && (
          <div className="absolute top-10 right-2 z-20 w-64 bg-[#09090B]/95 backdrop-blur border border-[#27272A] rounded-lg p-3 shadow-2xl flex flex-col gap-2.5 text-xs">
            <div className="flex items-center justify-between pb-1.5 border-b border-[#27272A]">
              <span className="font-semibold text-white text-[11px]">Synchronized View Settings</span>
              <button
                type="button"
                onClick={() => {
                  updateSettings((prev) => ({
                    ...prev,
                    windowWidth: volume.maxVal - volume.minVal || 100,
                    windowLevel: (volume.maxVal + volume.minVal) / 2 || 50
                  }));
                }}
                className="p-1 hover:bg-[#18181B] text-[#71717A] hover:text-white rounded"
                title="Reset Windowing"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>

            {/* Reset Pan if offset */}
            {(panOffset.x !== 0 || panOffset.y !== 0) && (
              <div className="flex items-center justify-between bg-[#18181B] p-1.5 rounded border border-[#27272A]">
                <span className="text-[10px] text-[#A1A1AA]">Pan Offset:</span>
                <button
                  type="button"
                  onClick={() => {
                    setPanOffset({ x: 0, y: 0 });
                  }}
                  className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[#27272A] text-[#38BDF8] hover:bg-[#38BDF8] hover:text-black transition-colors flex items-center gap-1"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>Center Pan</span>
                </button>
              </div>
            )}

            {/* Level slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] text-[#A1A1AA]">
                <span>Brightness (Level)</span>
                <span className="font-mono">{Math.round(windowLevel)}</span>
              </div>
              <input
                type="range"
                min={volume.minVal}
                max={volume.maxVal}
                value={windowLevel}
                onChange={(e) => updateSettings((prev) => ({ ...prev, windowLevel: parseFloat(e.target.value) }))}
                className="w-full accent-[#38BDF8] h-1 bg-[#27272A] rounded cursor-pointer"
              />
            </div>

            {/* Width slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] text-[#A1A1AA]">
                <span>Contrast (Width)</span>
                <span className="font-mono">{Math.round(windowWidth)}</span>
              </div>
              <input
                type="range"
                min="1"
                max={(volume.maxVal - volume.minVal) * 1.5 || 200}
                value={windowWidth}
                onChange={(e) => updateSettings((prev) => ({ ...prev, windowWidth: parseFloat(e.target.value) }))}
                className="w-full accent-[#38BDF8] h-1 bg-[#27272A] rounded cursor-pointer"
              />
            </div>

            {/* Colormap selection */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#A1A1AA]">Colormap:</span>
              <select
                value={colormap}
                onChange={(e) => updateSettings((prev) => ({ ...prev, colormap: e.target.value as ColormapType }))}
                className="bg-[#18181B] border border-[#27272A] rounded px-1.5 py-0.5 text-white text-xs focus:outline-none"
              >
                <option value="grayscale">Grayscale</option>
                <option value="inverted">Inverted</option>
                <option value="hot">Hot / Iron</option>
                <option value="bone">Bone</option>
                <option value="jet">Jet / Rainbow</option>
              </select>
            </div>
          </div>
        )}

        {/* Maximized Slice Viewport Container with Zero Wasted Space */}
        <div
          ref={containerRef}
          className="relative flex-1 w-full h-full flex items-center justify-center p-0 m-0 bg-[#000000] overflow-hidden select-none cursor-crosshair"
        >
          {/* Canvas Wrapper with Pan Offset */}
          <div
            style={{
              width: `${renderedWidth}px`,
              height: `${renderedHeight}px`,
              transform: `translate(${panOffset.x}px, ${panOffset.y}px)`
            }}
            className="relative flex items-center justify-center shrink-0"
          >
            <canvas
              ref={canvasRef}
              className="w-full h-full block shadow-2xl"
              style={{ imageRendering: 'pixelated' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
            />
          </div>

          {/* Floating Edge Orientation Markers Anchored to Container Edges */}
          {showOrientationLabels && plane === 'axial' && (
            <>
              <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-2 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">A</span>
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-2 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">P</span>
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-1.5 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">L</span>
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-1.5 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">R</span>
            </>
          )}
          {showOrientationLabels && plane === 'coronal' && (
            <>
              <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-2 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">S</span>
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-2 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">I</span>
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-1.5 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">L</span>
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-1.5 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">R</span>
            </>
          )}
          {showOrientationLabels && plane === 'sagittal' && (
            <>
              <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-2 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">S</span>
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-2 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">I</span>
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-1.5 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">P</span>
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/80 bg-black/70 backdrop-blur-xs px-1.5 py-0.5 rounded pointer-events-none tracking-widest border border-white/10 shadow-lg">A</span>
            </>
          )}
        </div>

        {/* Feedback Toast for Double-Click Actions */}
        {feedbackToast && (
          <div
            className={`absolute bottom-5 left-1/2 -translate-x-1/2 z-20 px-2.5 py-1 rounded text-[10px] font-medium shadow-lg backdrop-blur pointer-events-none transition-all ${
              feedbackToast.type === 'success'
                ? 'bg-[#10B981]/90 text-white border border-[#10B981]'
                : 'bg-[#18181B]/95 text-[#A1A1AA] border border-[#27272A]'
            }`}
          >
            {feedbackToast.text}
          </div>
        )}

        {/* Minimalist Bottom Scrubber Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 hover:h-2.5 bg-black/40 hover:bg-[#18181B]/90 transition-all z-10 flex items-center px-1">
          <input
            type="range"
            min="0"
            max={maxSliceIdx}
            value={currentSliceIdx}
            onChange={(e) => {
              const newIdx = parseInt(e.target.value, 10);
              onSliceIndexChange(newIdx);
            }}
            className="w-full accent-[#38BDF8] h-1 cursor-pointer"
          />
        </div>
      </div>
    );
  };

  // Render individual plane focus if requested
  if (activePlaneFocus && activePlaneFocus !== 'all') {
    if (activePlaneFocus === 'axial') {
      return (
        <div className="w-full h-full relative bg-black overflow-hidden">
          <OrthogonalSlice
            plane="axial"
            title="Axial"
            subLabel={`Z: ${axialWorldZ >= 0 ? '+' : ''}${axialWorldZ.toFixed(1)} mm`}
            currentSliceIdx={axialSlice}
            maxSliceIdx={nz - 1}
            onSliceIndexChange={(newK) => setAxialSlice(newK)}
            showStandaloneSettings={true}
          />
        </div>
      );
    }
    if (activePlaneFocus === 'coronal') {
      return (
        <div className="w-full h-full relative bg-black overflow-hidden">
          <OrthogonalSlice
            plane="coronal"
            title="Coronal"
            subLabel={`Y: ${coronalWorldY >= 0 ? '+' : ''}${coronalWorldY.toFixed(1)} mm`}
            currentSliceIdx={coronalSlice}
            maxSliceIdx={ny - 1}
            onSliceIndexChange={(newJ) => setCoronalSlice(newJ)}
            showStandaloneSettings={true}
          />
        </div>
      );
    }
    if (activePlaneFocus === 'sagittal') {
      return (
        <div className="w-full h-full relative bg-black overflow-hidden">
          <OrthogonalSlice
            plane="sagittal"
            title="Sagittal"
            subLabel={`X: ${sagittalWorldX >= 0 ? '+' : ''}${sagittalWorldX.toFixed(1)} mm`}
            currentSliceIdx={sagittalSlice}
            maxSliceIdx={nx - 1}
            onSliceIndexChange={(newI) => setSagittalSlice(newI)}
            showStandaloneSettings={true}
          />
        </div>
      );
    }
  }

  // Multi-slice Grid Layout (for 'all' slices focus mode)
  return (
    <div className="w-full h-full flex flex-col bg-[#000000] overflow-hidden select-none">
      {/* Top Synchronized Controls Toolbar for Multi-Slice */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#09090B] border-b border-[#27272A] text-xs shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-[#71717A] text-[10px] uppercase font-semibold">Level:</span>
            <input
              type="range"
              min={volume.minVal}
              max={volume.maxVal}
              value={windowLevel}
              onChange={(e) => updateSettings((prev) => ({ ...prev, windowLevel: parseFloat(e.target.value) }))}
              className="w-16 accent-[#38BDF8] h-1 bg-[#27272A] rounded cursor-pointer"
            />
            <span className="font-mono text-[#A1A1AA] text-[10px] w-7">{Math.round(windowLevel)}</span>
          </div>

          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-[#71717A] text-[10px] uppercase font-semibold">Width:</span>
            <input
              type="range"
              min="1"
              max={(volume.maxVal - volume.minVal) * 1.5 || 200}
              value={windowWidth}
              onChange={(e) => updateSettings((prev) => ({ ...prev, windowWidth: parseFloat(e.target.value) }))}
              className="w-16 accent-[#38BDF8] h-1 bg-[#27272A] rounded cursor-pointer"
            />
            <span className="font-mono text-[#A1A1AA] text-[10px] w-7">{Math.round(windowWidth)}</span>
          </div>

          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-[#71717A] text-[10px] uppercase font-semibold">Color:</span>
            <select
              value={colormap}
              onChange={(e) => updateSettings((prev) => ({ ...prev, colormap: e.target.value as ColormapType }))}
              className="bg-[#18181B] border border-[#27272A] rounded px-1.5 py-0.5 text-[#FAFAFA] text-xs focus:outline-none"
            >
              <option value="grayscale">Grayscale</option>
              <option value="inverted">Inverted</option>
              <option value="hot">Hot / Iron</option>
              <option value="bone">Bone</option>
              <option value="jet">Jet / Rainbow</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-[#A1A1AA]">
            <input
              type="checkbox"
              checked={showCrosshairs}
              onChange={(e) => updateSettings((prev) => ({ ...prev, showCrosshairs: e.target.checked }))}
              className="accent-[#38BDF8] rounded cursor-pointer"
            />
            <span>Crosshairs</span>
          </label>

          <div className="h-3 w-px bg-[#27272A]" />

          <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-[#A1A1AA]">
            <input
              type="checkbox"
              checked={drawContours}
              onChange={(e) => updateSettings((prev) => ({ ...prev, showSurfaceContours: e.target.checked }))}
              className="accent-[#38BDF8] rounded cursor-pointer"
            />
            <span>Contours</span>
          </label>
        </div>
      </div>

      {/* Cross-section Slices Grid - Fit Matrix */}
      <div className="flex-1 p-1 grid grid-cols-1 md:grid-cols-3 gap-1 overflow-hidden bg-[#000000]">
        <div className="border border-[#27272A] rounded overflow-hidden">
          <OrthogonalSlice
            plane="axial"
            title="Axial"
            subLabel={`Z: ${axialWorldZ >= 0 ? '+' : ''}${axialWorldZ.toFixed(1)} mm`}
            currentSliceIdx={axialSlice}
            maxSliceIdx={nz - 1}
            showStandaloneSettings={true}
            onSliceIndexChange={(newK) => setAxialSlice(newK)}
          />
        </div>

        <div className="border border-[#27272A] rounded overflow-hidden">
          <OrthogonalSlice
            plane="coronal"
            title="Coronal"
            subLabel={`Y: ${coronalWorldY >= 0 ? '+' : ''}${coronalWorldY.toFixed(1)} mm`}
            currentSliceIdx={coronalSlice}
            maxSliceIdx={ny - 1}
            showStandaloneSettings={true}
            onSliceIndexChange={(newJ) => setCoronalSlice(newJ)}
          />
        </div>

        <div className="border border-[#27272A] rounded overflow-hidden">
          <OrthogonalSlice
            plane="sagittal"
            title="Sagittal"
            subLabel={`X: ${sagittalWorldX >= 0 ? '+' : ''}${sagittalWorldX.toFixed(1)} mm`}
            currentSliceIdx={sagittalSlice}
            maxSliceIdx={nx - 1}
            showStandaloneSettings={true}
            onSliceIndexChange={(newI) => setSagittalSlice(newI)}
          />
        </div>
      </div>
    </div>
  );
};
