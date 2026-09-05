import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  SurfaceMesh,
  VolumeData,
  Parcellation,
  CrosshairState,
  WorldCoord,
  ViewLayout,
  ViewerOverlaySettings
} from './neuro/types';
import {
  CANONICAL_LEFT_SURF,
  CANONICAL_RIGHT_SURF,
  createGlasserParcellation,
  createBrodmannParcellation,
  createYeoNetworksParcellation,
  createCanonicalMniVolume
} from './neuro/canonicalData';
import {
  loadAllUploadedHcpDatasets,
  fetchAndParseLeftSurface,
  fetchAndParseRightSurface,
  fetchAndParseMniVolume,
  fetchAndParseGlasserParc,
  fetchAndParseBrodmannParc,
  fetchAndParseRsnParc,
  UploadedDatasetProgress,
  UPLOADED_FILES_MANIFEST
} from './neuro/datasetLoader';
import { Toolbar } from './components/Toolbar';
import { ThreeBrainViewer } from './components/ThreeBrainViewer';
import { CrossSectionViewer } from './components/CrossSectionViewer';
import { OverlayContextMenu, ContextMenuTarget } from './components/OverlayContextMenu';
import { RegionInspector } from './components/RegionInspector';
import { FileLoaderModal } from './components/FileLoaderModal';
import { HelpModal } from './components/HelpModal';

export default function App() {
  // 1. Neuroimaging Datasets State (initialized with authentic canonical reference)
  const [leftSurface, setLeftSurface] = useState<SurfaceMesh>(CANONICAL_LEFT_SURF);
  const [rightSurface, setRightSurface] = useState<SurfaceMesh>(CANONICAL_RIGHT_SURF);
  const [volume, setVolume] = useState<VolumeData>(() => createCanonicalMniVolume());

  // Parcellation collection
  const defaultParcellations = useMemo(() => {
    return {
      glasser_hcp_mmp: createGlasserParcellation(leftSurface, rightSurface),
      brodmann_atlas: createBrodmannParcellation(leftSurface, rightSurface),
      yeo_rsn_networks: createYeoNetworksParcellation(leftSurface, rightSurface)
    };
  }, [leftSurface, rightSurface]);

  const [loadedParcellations, setLoadedParcellations] = useState<Record<string, Parcellation>>({});
  const [activeParcId, setActiveParcId] = useState<string>('glasser_hcp_mmp');
  const [activeColorMode, setActiveColorMode] = useState<'parcellation' | 'curvature' | 'solid'>(
    'parcellation'
  );

  // Combined Parcellation Dictionary
  const allParcellations = useMemo(() => {
    return {
      ...defaultParcellations,
      ...loadedParcellations
    };
  }, [defaultParcellations, loadedParcellations]);

  // Dynamic parcellation options for toolbar
  const parcellationOptions = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    Object.keys(allParcellations).forEach((key) => {
      const p = allParcellations[key as keyof typeof allParcellations];
      if (p) {
        list.push({ id: p.id, name: p.name });
      }
    });
    return list;
  }, [allParcellations]);

  // Active parcellation object
  const currentParcellation = useMemo(() => {
    return (allParcellations as any)[activeParcId] || defaultParcellations.glasser_hcp_mmp;
  }, [allParcellations, activeParcId, defaultParcellations]);

  // Track if custom files are active
  const [isCustomLeftSurf, setIsCustomLeftSurf] = useState(false);
  const [isCustomRightSurf, setIsCustomRightSurf] = useState(false);
  const [isCustomVolume, setIsCustomVolume] = useState(false);
  const [isCustomParc, setIsCustomParc] = useState(false);

  // Dataset loader states
  const [isDatasetLoading, setIsDatasetLoading] = useState(false);
  const [datasetProgress, setDatasetProgress] = useState<UploadedDatasetProgress | null>(null);

  // 2. Crosshair & Bi-Directional Synchronization State
  // Initialized at Motor Hand Knob (M1: X: -38, Y: -22, Z: 56)
  const [crosshair, setCrosshair] = useState<CrosshairState>(() => {
    const initialCoord: WorldCoord = { x: -38, y: -22, z: 56 };
    const parc = defaultParcellations.glasser_hcp_mmp;
    return {
      mni: initialCoord,
      nearestSurfacePoint: initialCoord,
      nearestVertexIndex: 0,
      nearestHemi: 'left',
      activeLabel: parc.labels.get(1),
      sourceView: 'manual'
    };
  });

  // Synchronized Overlay Options State across all cross-section views
  const [overlaySettings, setOverlaySettings] = useState<ViewerOverlaySettings>({
    showCrosshairs: true,
    showSurfaceContours: true,
    showOrientationLabels: true,
    colormap: 'grayscale',
    windowWidth: 100,
    windowLevel: 50,
    fitMode: 'fit',
    zoomLevel: 1.0
  });

  // Right-Click Context Menu State
  const [contextMenuTarget, setContextMenuTarget] = useState<ContextMenuTarget | null>(null);

  const [snapToSurface, setSnapToSurface] = useState<boolean>(true);
  const [layout, setLayout] = useState<ViewLayout>('quad');
  const [fileModalOpen, setFileModalOpen] = useState<boolean>(false);
  const [helpModalOpen, setHelpModalOpen] = useState<boolean>(false);

  // All active surfaces array
  const activeSurfaces = useMemo(() => {
    const arr: SurfaceMesh[] = [];
    if (leftSurface) arr.push(leftSurface);
    if (rightSurface) arr.push(rightSurface);
    return arr;
  }, [leftSurface, rightSurface]);

  // Sync windowing defaults when volume changes
  useEffect(() => {
    if (volume) {
      setOverlaySettings((prev) => ({
        ...prev,
        windowWidth: volume.maxVal - volume.minVal || 100,
        windowLevel: (volume.maxVal + volume.minVal) / 2 || 50
      }));
    }
  }, [volume]);

  // Right-click context menu trigger for cross-section views
  const handleSliceContextMenu = useCallback(
    (e: React.MouseEvent, plane: 'axial' | 'coronal' | 'sagittal', coord: WorldCoord) => {
      setContextMenuTarget({
        x: e.clientX,
        y: e.clientY,
        plane,
        coord
      });
    },
    []
  );

  // Recalculate crosshair vertex info when surfaces or active parcellation change
  const refreshCrosshairForSurfaces = useCallback(
    (coord: WorldCoord, _surfaces: SurfaceMesh[], parc: Parcellation) => {
      setCrosshair((prev) => ({
        ...prev,
        mni: coord
      }));
    },
    []
  );

  // Auto-load uploaded HCP S1200 / MNI152 datasets by default on startup
  useEffect(() => {
    let active = true;
    const autoLoad = async () => {
      setIsDatasetLoading(true);
      setDatasetProgress({ step: 'Loading uploaded HCP S1200 & MNI152 datasets...', percent: 15 });
      try {
        const data = await loadAllUploadedHcpDatasets((p) => {
          if (active) setDatasetProgress(p);
        });
        if (!active) return;
        setLeftSurface(data.leftSurf);
        setRightSurface(data.rightSurf);
        setVolume(data.volume);
        setLoadedParcellations((prev) => ({
          ...prev,
          ...data.parcellations
        }));
        setActiveParcId('glasser_hcp_mmp');
        setActiveColorMode('parcellation');
        setIsCustomLeftSurf(true);
        setIsCustomRightSurf(true);
        setIsCustomVolume(true);
        setIsCustomParc(true);

        refreshCrosshairForSurfaces(
          { x: -38.5, y: -22.0, z: 56.5 },
          [data.leftSurf, data.rightSurf],
          data.parcellations.glasser_hcp_mmp
        );
      } catch (err) {
        console.warn('Initial default load of uploaded files failed, using canonical backup:', err);
      } finally {
        if (active) {
          setIsDatasetLoading(false);
          setDatasetProgress(null);
        }
      }
    };
    autoLoad();
    return () => {
      active = false;
    };
  }, [refreshCrosshairForSurfaces]);

  // Handler for loading ALL uploaded datasets manually
  const handleLoadAllUploadedDatasets = async () => {
    setIsDatasetLoading(true);
    setDatasetProgress({ step: 'Initializing dataset pipeline...', percent: 5 });
    try {
      const data = await loadAllUploadedHcpDatasets((p) => setDatasetProgress(p));
      setLeftSurface(data.leftSurf);
      setRightSurface(data.rightSurf);
      setVolume(data.volume);
      setLoadedParcellations((prev) => ({
        ...prev,
        ...data.parcellations
      }));
      setActiveParcId('glasser_hcp_mmp');
      setActiveColorMode('parcellation');
      setIsCustomLeftSurf(true);
      setIsCustomRightSurf(true);
      setIsCustomVolume(true);
      setIsCustomParc(true);

      // Re-anchor crosshair to motor hand knob on new high-res surface
      refreshCrosshairForSurfaces(crosshair.mni, [data.leftSurf, data.rightSurf], data.parcellations.glasser_hcp_mmp);
    } finally {
      setIsDatasetLoading(false);
      setDatasetProgress(null);
    }
  };

  // Handler for loading individual uploaded files
  const handleLoadSingleUploadedDataset = async (fileKey: keyof typeof UPLOADED_FILES_MANIFEST) => {
    setIsDatasetLoading(true);
    try {
      if (fileKey === 'leftSurf') {
        const surf = await fetchAndParseLeftSurface();
        setLeftSurface(surf);
        setIsCustomLeftSurf(true);
      } else if (fileKey === 'rightSurf') {
        const surf = await fetchAndParseRightSurface();
        setRightSurface(surf);
        setIsCustomRightSurf(true);
      } else if (fileKey === 'volume') {
        const vol = await fetchAndParseMniVolume();
        setVolume(vol);
        setIsCustomVolume(true);
      } else if (fileKey === 'glasserParc') {
        const parc = await fetchAndParseGlasserParc();
        setLoadedParcellations((prev) => ({ ...prev, [parc.id]: parc }));
        setActiveParcId(parc.id);
        setActiveColorMode('parcellation');
        setIsCustomParc(true);
      } else if (fileKey === 'brodmannParc') {
        const parc = await fetchAndParseBrodmannParc();
        setLoadedParcellations((prev) => ({ ...prev, [parc.id]: parc }));
        setActiveParcId(parc.id);
        setActiveColorMode('parcellation');
        setIsCustomParc(true);
      } else if (fileKey === 'rsnParc') {
        const parc = await fetchAndParseRsnParc();
        setLoadedParcellations((prev) => ({ ...prev, [parc.id]: parc }));
        setActiveParcId(parc.id);
        setActiveColorMode('parcellation');
        setIsCustomParc(true);
      }
    } finally {
      setIsDatasetLoading(false);
    }
  };

  // Bi-directional interaction 1: User clicks on 3D Brain Surface -> Re-centers cross-sections!
  const handleSurfacePointClicked = useCallback(
    (coord: WorldCoord, vertexIndex: number, hemi: 'left' | 'right') => {
      // Find label for this vertex in active parcellation
      const vLabels =
        hemi === 'left' ? currentParcellation?.vertexLabelsL : currentParcellation?.vertexLabelsR;
      const labelKey = vLabels ? vLabels[vertexIndex] : undefined;
      const activeLabel =
        labelKey !== undefined ? currentParcellation?.labels.get(labelKey) : undefined;

      setCrosshair({
        mni: coord,
        nearestSurfacePoint: coord,
        surfaceDistance: 0.0,
        nearestVertexIndex: vertexIndex,
        nearestHemi: hemi,
        activeLabel,
        sourceView: 'surface'
      });
    },
    [currentParcellation]
  );

  // Bi-directional interaction 2: User clicks or double clicks on cross-section slice ->
  // Updates 3D crosshair position immediately with zero lag or screen flicker
  const handleSliceClicked = useCallback(
    (coord: WorldCoord, source: 'axial' | 'coronal' | 'sagittal') => {
      setCrosshair((prev) => ({
        ...prev,
        mni: coord,
        sourceView: source
      }));
    },
    []
  );

  // Jump to specific landmark or manual coordinate
  const handleJumpToCoord = useCallback(
    (coord: WorldCoord) => {
      setCrosshair((prev) => ({
        ...prev,
        mni: coord,
        sourceView: 'manual'
      }));
    },
    []
  );

  // Custom File Loaded Handlers
  const handleSurfaceLoaded = (surf: SurfaceMesh) => {
    if (surf.hemi === 'left') {
      setLeftSurface(surf);
      setIsCustomLeftSurf(true);
    } else {
      setRightSurface(surf);
      setIsCustomRightSurf(true);
    }
  };

  const handleVolumeLoaded = (vol: VolumeData) => {
    setVolume(vol);
    setIsCustomVolume(true);
  };

  const handleParcellationLoaded = (parc: Parcellation) => {
    setLoadedParcellations((prev) => ({ ...prev, [parc.id]: parc }));
    setActiveParcId(parc.id);
    setActiveColorMode('parcellation');
    setIsCustomParc(true);
  };

  const handleResetDefaults = () => {
    setLeftSurface(CANONICAL_LEFT_SURF);
    setRightSurface(CANONICAL_RIGHT_SURF);
    setVolume(createCanonicalMniVolume());
    setLoadedParcellations({});
    setActiveParcId('glasser_hcp_mmp');
    setIsCustomLeftSurf(false);
    setIsCustomRightSurf(false);
    setIsCustomVolume(false);
    setIsCustomParc(false);
  };

  return (
    <div className="flex flex-col w-screen h-screen bg-[#09090B] text-[#FAFAFA] overflow-hidden font-sans">
      {/* Top Application Toolbar */}
      <Toolbar
        layout={layout}
        onLayoutChange={setLayout}
        selectedParcellationId={activeParcId}
        onParcellationChange={setActiveParcId}
        parcellationOptions={parcellationOptions}
        activeColorMode={activeColorMode}
        onColorModeChange={setActiveColorMode}
        snapToSurface={snapToSurface}
        onToggleSnapToSurface={() => setSnapToSurface(!snapToSurface)}
        onOpenFileManager={() => setFileModalOpen(true)}
        onOpenHelp={() => setHelpModalOpen(true)}
        hasCustomFiles={isCustomLeftSurf || isCustomRightSurf || isCustomVolume || isCustomParc}
        onLoadUploadedDataset={handleLoadAllUploadedDatasets}
        isLoadingUploaded={isDatasetLoading}
      />

      {/* Main Multi-Viewport Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left / Center Viewport Area based on selected Bento layout */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#000000] overflow-hidden">
          {layout === 'quad' && (
            <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 grid-rows-2 p-1.5 gap-1.5 bg-[#000000] overflow-hidden">
              {/* Sagittal Slice Bento Cell */}
              <div className="bg-[#000000] border border-[#27272A] rounded-md relative overflow-hidden flex flex-col">
                <CrossSectionViewer
                  volume={volume}
                  crosshair={crosshair.mni}
                  surfaces={activeSurfaces}
                  onSliceClicked={handleSliceClicked}
                  activePlaneFocus="sagittal"
                  overlaySettings={overlaySettings}
                  onOverlaySettingsChange={setOverlaySettings}
                  onContextMenu={handleSliceContextMenu}
                />
              </div>

              {/* Coronal Slice Bento Cell */}
              <div className="bg-[#000000] border border-[#27272A] rounded-md relative overflow-hidden flex flex-col">
                <CrossSectionViewer
                  volume={volume}
                  crosshair={crosshair.mni}
                  surfaces={activeSurfaces}
                  onSliceClicked={handleSliceClicked}
                  activePlaneFocus="coronal"
                  overlaySettings={overlaySettings}
                  onOverlaySettingsChange={setOverlaySettings}
                  onContextMenu={handleSliceContextMenu}
                />
              </div>

              {/* Axial Slice Bento Cell */}
              <div className="bg-[#000000] border border-[#27272A] rounded-md relative overflow-hidden flex flex-col">
                <CrossSectionViewer
                  volume={volume}
                  crosshair={crosshair.mni}
                  surfaces={activeSurfaces}
                  onSliceClicked={handleSliceClicked}
                  activePlaneFocus="axial"
                  overlaySettings={overlaySettings}
                  onOverlaySettingsChange={setOverlaySettings}
                  onContextMenu={handleSliceContextMenu}
                />
              </div>

              {/* 3D Surface View Bento Cell */}
              <div className="bg-[#09090B] border border-[#38BDF8]/40 rounded-md relative overflow-hidden flex flex-col shadow-lg shadow-[#38BDF8]/5">
                <ThreeBrainViewer
                  leftSurface={leftSurface}
                  rightSurface={rightSurface}
                  parcellation={currentParcellation}
                  activeColorMode={activeColorMode}
                  crosshair={crosshair}
                  onSurfacePointClicked={handleSurfacePointClicked}
                  showMarkerOnSurface={true}
                />
              </div>
            </main>
          )}

          {layout === 'surface_focus' && (
            <div className="flex-1 p-1.5 bg-[#000000] overflow-hidden">
              <div className="w-full h-full bg-[#09090B] border border-[#38BDF8]/40 rounded-md overflow-hidden flex flex-col shadow-xl">
                <ThreeBrainViewer
                  leftSurface={leftSurface}
                  rightSurface={rightSurface}
                  parcellation={currentParcellation}
                  activeColorMode={activeColorMode}
                  crosshair={crosshair}
                  onSurfacePointClicked={handleSurfacePointClicked}
                  showMarkerOnSurface={true}
                />
              </div>
            </div>
          )}

          {layout === 'slices_focus' && (
            <div className="flex-1 p-1.5 bg-[#000000] overflow-hidden">
              <div className="w-full h-full bg-[#000000] border border-[#27272A] rounded-md overflow-hidden flex flex-col">
                <CrossSectionViewer
                  volume={volume}
                  crosshair={crosshair.mni}
                  surfaces={activeSurfaces}
                  onSliceClicked={handleSliceClicked}
                  activePlaneFocus="all"
                  overlaySettings={overlaySettings}
                  onOverlaySettingsChange={setOverlaySettings}
                  onContextMenu={handleSliceContextMenu}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar: Region Inspector & HUD (Bento Sidebar) */}
        <aside className="w-[280px] border-l border-[#27272A] bg-[#09090B] flex flex-col shrink-0 hidden md:flex">
          <RegionInspector
            crosshair={crosshair}
            parcellation={currentParcellation}
            onJumpToCoord={handleJumpToCoord}
          />
        </aside>
      </div>

      {/* Bento Status Bar Footer */}
      <footer className="h-8 border-t border-[#27272A] bg-[#09090B] flex items-center justify-between px-4 text-[10px] text-[#71717A] shrink-0 select-none">
        <div className="flex gap-4 items-center overflow-hidden">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-2 h-2 bg-[#10B981] rounded-full animate-pulse" />
            <span className="font-semibold tracking-wider text-[#A1A1AA]">GPU RENDERER ACTIVE</span>
          </div>
          <div className="h-3 w-[1px] bg-[#27272A] shrink-0" />
          <span className="shrink-0">
            MNI: <span className="text-white font-mono font-medium">{crosshair.mni.x.toFixed(1)}, {crosshair.mni.y.toFixed(1)}, {crosshair.mni.z.toFixed(1)}</span>
          </span>
          {crosshair.activeLabel && (
            <span className="hidden md:inline truncate">
              LABEL: <span className="text-[#38BDF8] font-bold">{crosshair.activeLabel.name}</span>
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#71717A] font-mono uppercase tracking-tight shrink-0 hidden lg:block">
          ATLAS: <span className="text-[#A1A1AA]">{currentParcellation?.name || 'Glasser HCP-MMP1.0'}</span>
        </div>
      </footer>

      {/* Right-Click Overlay Options Context Menu */}
      {contextMenuTarget && (
        <OverlayContextMenu
          target={contextMenuTarget}
          overlaySettings={overlaySettings}
          onUpdateSettings={setOverlaySettings}
          onCenterCrosshair={handleJumpToCoord}
          onResetZoomPan={() => {
            setOverlaySettings((prev) => ({ ...prev, fitMode: 'fit', zoomLevel: 1.0 }));
          }}
          onClose={() => setContextMenuTarget(null)}
        />
      )}

      {/* File Manager Modal */}
      <FileLoaderModal
        isOpen={fileModalOpen}
        onClose={() => setFileModalOpen(false)}
        onSurfaceLoaded={handleSurfaceLoaded}
        onVolumeLoaded={handleVolumeLoaded}
        onParcellationLoaded={handleParcellationLoaded}
        onResetDefaults={handleResetDefaults}
        onLoadAllUploadedDatasets={handleLoadAllUploadedDatasets}
        onLoadSingleUploadedDataset={handleLoadSingleUploadedDataset}
        datasetProgress={datasetProgress}
        isDatasetLoading={isDatasetLoading}
        loadedFileStatuses={{
          leftSurfName: leftSurface?.sourceFileName || 'S1200.L.pial_MSMAll.32k_fs_LR.surf.gii',
          rightSurfName: rightSurface?.sourceFileName || 'S1200.R.pial_MSMAll.32k_fs_LR.surf.gii',
          volumeName: volume?.name || 'MNI152_T1_0.7mm.nii.gz',
          parcellationName: currentParcellation?.name || 'Glasser HCP-MMP1.0',
          isCustomLeftSurf,
          isCustomRightSurf,
          isCustomVolume,
          isCustomParc
        }}
      />

      {/* Help Modal */}
      <HelpModal isOpen={helpModalOpen} onClose={() => setHelpModalOpen(false)} />
    </div>
  );
}
