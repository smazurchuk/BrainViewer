import React, { useState, useRef, useEffect } from 'react';
import { VolumeData, WorldCoord, SurfaceMesh, ViewerOverlaySettings, FiduciaryMarker } from '../neuro/types';
import { worldToVoxel, voxelToWorld } from '../neuro/matrixUtils';
import { OrthogonalSlice } from './OrthogonalSlice';

export interface CrossSectionViewerProps {
  volume: VolumeData | null;
  crosshair: WorldCoord;
  surfaces?: SurfaceMesh[];
  fiduciaryMarker?: FiduciaryMarker | null;
  onSliceClicked: (mni: WorldCoord, source: 'axial' | 'coronal' | 'sagittal') => void;
  onSurfaceContourDoubleClicked?: (hitCoord: WorldCoord, surf: SurfaceMesh, hemi: 'left' | 'right') => void;
  showSurfaceContours?: boolean;
  activePlaneFocus?: 'all' | 'axial' | 'coronal' | 'sagittal';
  overlaySettings?: ViewerOverlaySettings;
  onOverlaySettingsChange?: (updater: (prev: ViewerOverlaySettings) => ViewerOverlaySettings) => void;
  onReady?: () => void;
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
  onReady,
}) => {
  // Track first render to fire onReady callback exactly once
  const readyFiredRef = useRef(false);

  // All hooks MUST be above any early returns to satisfy React Rules of Hooks
  const [localSettings, setLocalSettings] = useState<ViewerOverlaySettings>({
    showCrosshairs: true,
    showSurfaceContours: showSurfaceContours,
    showOrientationLabels: true,
    colormap: 'grayscale',
    windowWidth: 100,
    windowLevel: 50,
    fitMode: 'fit',
    zoomLevel: 1.0
  });

  // Sync windowing defaults when volume first arrives
  const volumeInitRef = useRef(false);
  useEffect(() => {
    if (volume && !volumeInitRef.current) {
      volumeInitRef.current = true;
      setLocalSettings(prev => ({
        ...prev,
        windowWidth: volume.maxVal - volume.minVal || 100,
        windowLevel: (volume.maxVal + volume.minVal) / 2 || 50
      }));
    }
  }, [volume]);

  useEffect(() => {
    if (volume && !readyFiredRef.current) {
      readyFiredRef.current = true;
      // Wait one frame for the canvas to actually paint
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          onReady?.();
        });
      });
    }
  }, [volume, onReady]);

  const settings = overlaySettings || localSettings;
  const updateSettings = onOverlaySettingsChange || setLocalSettings;

  const {
    showCrosshairs,
    showSurfaceContours: drawContours,
    showOrientationLabels,
    colormap,
    windowWidth,
    windowLevel,
  } = settings;

  // Show loading placeholder when volume data is not yet available
  if (!volume) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black text-[#71717A] text-xs font-mono">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-[#38BDF8] border-t-transparent rounded-full animate-spin" />
          <span>Loading volume data...</span>
        </div>
      </div>
    );
  }

  // Convert current MNI world coordinate to volume voxel indices
  const currentVoxel = worldToVoxel(crosshair, volume.invAffine);
  const [nx, ny, nz] = volume.dims;

  // Clamped voxel indices (0-indexed)
  const curI = Math.max(0, Math.min(nx - 1, currentVoxel.i));
  const curJ = Math.max(0, Math.min(ny - 1, currentVoxel.j));
  const curK = Math.max(0, Math.min(nz - 1, currentVoxel.k));

  const axialWorldZ = voxelToWorld({ i: curI, j: curJ, k: curK }, volume.affine).z;
  const coronalWorldY = voxelToWorld({ i: curI, j: curJ, k: curK }, volume.affine).y;
  const sagittalWorldX = voxelToWorld({ i: curI, j: curJ, k: curK }, volume.affine).x;

  const commonSliceProps = {
    volume,
    curI,
    curJ,
    curK,
    surfaces,
    fiduciaryMarker,
    onSliceClicked,
    onSurfaceContourDoubleClicked,
    showCrosshairs,
    drawContours,
    showOrientationLabels,
    colormap,
    windowWidth,
    windowLevel,
    updateSettings,
    showStandaloneSettings: true
  };

  // If single plane focus requested (e.g. within Bento layout cells)
  if (activePlaneFocus !== 'all') {
    let title = 'Axial';
    let subLabel = `Z: ${axialWorldZ >= 0 ? '+' : ''}${axialWorldZ.toFixed(0)} mm`;
    let currentSliceIdx = curK;
    let maxSliceIdx = nz - 1;

    if (activePlaneFocus === 'sagittal') {
      title = 'Sagittal';
      subLabel = `X: ${sagittalWorldX >= 0 ? '+' : ''}${sagittalWorldX.toFixed(0)} mm`;
      currentSliceIdx = curI;
      maxSliceIdx = nx - 1;
    } else if (activePlaneFocus === 'coronal') {
      title = 'Coronal';
      subLabel = `Y: ${coronalWorldY >= 0 ? '+' : ''}${coronalWorldY.toFixed(0)} mm`;
      currentSliceIdx = curJ;
      maxSliceIdx = ny - 1;
    }

    return (
      <div className="w-full h-full relative bg-black overflow-hidden min-w-0 min-h-0">
        <OrthogonalSlice
          {...commonSliceProps}
          plane={activePlaneFocus}
          title={title}
          subLabel={subLabel}
          currentSliceIdx={currentSliceIdx}
          maxSliceIdx={maxSliceIdx}
          onSliceIndexChange={(newIdx) => {
            let updatedVoxel: { i: number; j: number; k: number };
            if (activePlaneFocus === 'sagittal') {
              updatedVoxel = { i: newIdx, j: curJ, k: curK };
            } else if (activePlaneFocus === 'coronal') {
              updatedVoxel = { i: curI, j: newIdx, k: curK };
            } else {
              updatedVoxel = { i: curI, j: curJ, k: newIdx };
            }
            onSliceClicked(voxelToWorld(updatedVoxel, volume.affine), activePlaneFocus);
          }}
        />
      </div>
    );
  }

  // Multi-plane 3-view display (used when activePlaneFocus === 'all')
  return (
    <div className="w-full h-full grid grid-cols-1 md:grid-cols-3 gap-1.5 p-1.5 bg-[#000000] overflow-hidden min-w-0 min-h-0">
      {/* Sagittal Plane */}
      <div className="bg-[#000000] border border-[#27272A] rounded-md relative overflow-hidden flex flex-col min-w-0 min-h-0">
        <OrthogonalSlice
          {...commonSliceProps}
          plane="sagittal"
          title="Sagittal"
          subLabel={`X: ${sagittalWorldX >= 0 ? '+' : ''}${sagittalWorldX.toFixed(0)} mm`}
          currentSliceIdx={curI}
          maxSliceIdx={nx - 1}
          onSliceIndexChange={(newI) => {
            const updated = { i: newI, j: curJ, k: curK };
            onSliceClicked(voxelToWorld(updated, volume.affine), 'sagittal');
          }}
        />
      </div>

      {/* Coronal Plane */}
      <div className="bg-[#000000] border border-[#27272A] rounded-md relative overflow-hidden flex flex-col min-w-0 min-h-0">
        <OrthogonalSlice
          {...commonSliceProps}
          plane="coronal"
          title="Coronal"
          subLabel={`Y: ${coronalWorldY >= 0 ? '+' : ''}${coronalWorldY.toFixed(0)} mm`}
          currentSliceIdx={curJ}
          maxSliceIdx={ny - 1}
          onSliceIndexChange={(newJ) => {
            const updated = { i: curI, j: newJ, k: curK };
            onSliceClicked(voxelToWorld(updated, volume.affine), 'coronal');
          }}
        />
      </div>

      {/* Axial Plane */}
      <div className="bg-[#000000] border border-[#27272A] rounded-md relative overflow-hidden flex flex-col min-w-0 min-h-0">
        <OrthogonalSlice
          {...commonSliceProps}
          plane="axial"
          title="Axial"
          subLabel={`Z: ${axialWorldZ >= 0 ? '+' : ''}${axialWorldZ.toFixed(0)} mm`}
          currentSliceIdx={curK}
          maxSliceIdx={nz - 1}
          onSliceIndexChange={(newK) => {
            const updated = { i: curI, j: curJ, k: newK };
            onSliceClicked(voxelToWorld(updated, volume.affine), 'axial');
          }}
        />
      </div>
    </div>
  );
};
