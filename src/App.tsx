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
import { findNearestSurfaceVertex } from './neuro/surfaceUtils';
import {
  loadAllUploadedHcpDatasets,
  fetchAndParseLeftSurface,
  fetchAndParseRightSurface,
  fetchAndParseMniVolume,
  fetchAndParseGlasserParc,
  fetchAndParseBrodmannParc,
  fetchAndParseRsnParc,
  UploadedDatasetProgress,
  UPLOADED_FILES_MANIFEST,
  LoadedHcpBundle
} from './neuro/datasetLoader';
import { Toolbar } from './components/Toolbar';
import { ThreeBrainViewer, FocusTarget } from './components/ThreeBrainViewer';
import { CrossSectionViewer } from './components/CrossSectionViewer';
import { RegionInspector } from './components/RegionInspector';
import { FileLoaderModal } from './components/FileLoaderModal';
import { HelpModal } from './components/HelpModal';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  // 1. Neuroimaging Datasets State — start with null to avoid memory doubling
  // Real HCP data is auto-loaded on mount (see useEffect below)
  const [leftSurface, setLeftSurface] = useState<SurfaceMesh | null>(null);
  const [rightSurface, setRightSurface] = useState<SurfaceMesh | null>(null);
  const [volume, setVolume] = useState<VolumeData | null>(null);

  const [loadedParcellations, setLoadedParcellations] = useState<Record<string, Parcellation>>({});
  const [activeParcId, setActiveParcId] = useState<string>('glasser_hcp_mmp');
  const [activeColorMode, setActiveColorMode] = useState<'parcellation' | 'curvature' | 'solid'>(
    'parcellation'
  );

  // Combined Parcellation Dictionary
  const allParcellations = useMemo(() => {
    return { ...loadedParcellations };
  }, [loadedParcellations]);

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
    return (allParcellations as any)[activeParcId] || null;
  }, [allParcellations, activeParcId]);

  // Track if custom files are active
  const [isCustomLeftSurf, setIsCustomLeftSurf] = useState(false);
  const [isCustomRightSurf, setIsCustomRightSurf] = useState(false);
  const [isCustomVolume, setIsCustomVolume] = useState(false);
  const [isCustomParc, setIsCustomParc] = useState(false);

  // Dataset loader states
  const [isDatasetLoading, setIsDatasetLoading] = useState(false);
  const [datasetProgress, setDatasetProgress] = useState<UploadedDatasetProgress | null>(null);

  // Rendering phase: loading overlay stays visible until viewers render their first frame
  const [isRenderingPhase, setIsRenderingPhase] = useState(false);
  const [viewersReady, setViewersReady] = useState({ surface3d: false, slices: false });

  const handleViewerReady = useCallback((viewer: 'surface3d' | 'slices') => {
    setViewersReady(prev => ({ ...prev, [viewer]: true }));
  }, []);

  // Dismiss rendering overlay once all viewers have rendered
  useEffect(() => {
    if (isRenderingPhase && viewersReady.surface3d && viewersReady.slices) {
      setIsRenderingPhase(false);
      setDatasetProgress(null);
    }
  }, [isRenderingPhase, viewersReady]);

  // Safety timeout: dismiss rendering overlay after 2s even if viewers haven't signaled
  useEffect(() => {
    if (!isRenderingPhase) return;
    const timeout = setTimeout(() => {
      setIsRenderingPhase(false);
      setDatasetProgress(null);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [isRenderingPhase]);

  // Combined flag: show loading overlay during either data-fetch or rendering phase
  const showLoadingOverlay = isDatasetLoading || isRenderingPhase;

  // 2. Crosshair & Bi-Directional Synchronization State
  // Initialized at origin — will be updated once real data loads
  const [crosshair, setCrosshair] = useState<CrosshairState>({
    mni: { x: 0, y: 0, z: 0 },
    sourceView: 'manual'
  });

  // 3D Surface View Focus Target — triggers camera animation when a landmark or surface point is selected
  const focusSeqRef = React.useRef(0);
  const [surfaceFocusTarget, setSurfaceFocusTarget] = useState<FocusTarget | null>(null);

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

  // Flag indicating whether initial data has been loaded
  const isDataReady = !!(leftSurface && rightSurface && volume);

  // Recalculate crosshair vertex info when surfaces or active parcellation change
  const refreshCrosshairForSurfaces = useCallback(
    (coord: WorldCoord, surfaces: SurfaceMesh[], parc?: Parcellation) => {
      const nearest = findNearestSurfaceVertex(coord, surfaces);
      if (nearest) {
        const targetParc = parc || currentParcellation;
        const vLabels =
          nearest.hemi === 'left' ? targetParc?.vertexLabelsL : targetParc?.vertexLabelsR;
        const labelKey = vLabels ? vLabels[nearest.vertexIndex] : undefined;
        const activeLabel =
          labelKey !== undefined ? targetParc?.labels.get(labelKey) : undefined;

        setCrosshair({
          mni: coord,
          nearestSurfacePoint: nearest.nearestPoint,
          surfaceDistance: nearest.distance,
          nearestVertexIndex: nearest.vertexIndex,
          nearestHemi: nearest.hemi,
          activeLabel,
          sourceView: 'manual'
        });
      } else {
        setCrosshair((prev) => ({
          ...prev,
          mni: coord
        }));
      }
    },
    [currentParcellation]
  );

  // Automatically update active parcel label whenever the parcellation atlas is switched
  useEffect(() => {
    if (crosshair.nearestVertexIndex !== undefined && crosshair.nearestHemi && currentParcellation) {
      const vLabels =
        crosshair.nearestHemi === 'left'
          ? currentParcellation.vertexLabelsL
          : currentParcellation.vertexLabelsR;
      const labelKey = vLabels ? vLabels[crosshair.nearestVertexIndex] : undefined;
      const activeLabel =
        labelKey !== undefined ? currentParcellation.labels.get(labelKey) : undefined;
      setCrosshair((prev) => ({
        ...prev,
        activeLabel
      }));
    }
  }, [currentParcellation]);

  // Auto-load uploaded HCP S1200 / MNI152 datasets by default on startup (run once)
  const autoLoadStartedRef = React.useRef(false);
  const isMountedRef = React.useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Consolidate dataset bundle application in one single batch
  const applyLoadedHcpBundle = useCallback(
    (data: LoadedHcpBundle, targetMni?: WorldCoord) => {
      setLeftSurface(data.leftSurf);
      setRightSurface(data.rightSurf);
      setVolume(data.volume);
      setLoadedParcellations({
        [data.glasserParc.id]: data.glasserParc,
        [data.brodmannParc.id]: data.brodmannParc,
        [data.rsnParc.id]: data.rsnParc
      });
      setActiveParcId(data.glasserParc.id);
      setActiveColorMode('parcellation');
      setIsCustomLeftSurf(true);
      setIsCustomRightSurf(true);
      setIsCustomVolume(true);
      setIsCustomParc(true);

      const targetCoord = targetMni || { x: 0, y: 0, z: 0 };
      refreshCrosshairForSurfaces(targetCoord, [data.leftSurf, data.rightSurf], data.glasserParc);
    },
    [refreshCrosshairForSurfaces]
  );

  useEffect(() => {
    if (autoLoadStartedRef.current) return;
    autoLoadStartedRef.current = true;

    const autoLoad = async () => {
      setIsDatasetLoading(true);
      setDatasetProgress({ step: 'Loading HCP S1200 & MNI152 datasets...', percent: 5 });
      try {
        const data = await loadAllUploadedHcpDatasets((p) => {
          if (isMountedRef.current) setDatasetProgress(p);
        });
        if (!isMountedRef.current) return;
        applyLoadedHcpBundle(data);
        // Transition to rendering phase — keep overlay until viewers are ready
        setIsDatasetLoading(false);
        setViewersReady({ surface3d: false, slices: false });
        setIsRenderingPhase(true);
        setDatasetProgress({ step: 'Initializing viewers...', percent: 95 });
      } catch (err) {
        console.error('Auto-load of HCP datasets failed:', err);
        setIsDatasetLoading(false);
        setDatasetProgress(null);
      }
    };

    autoLoad();
  }, [applyLoadedHcpBundle]);

  // Handler for loading ALL uploaded datasets manually
  const handleLoadAllUploadedDatasets = async () => {
    setIsDatasetLoading(true);
    setDatasetProgress({ step: 'Initializing dataset pipeline...', percent: 5 });
    try {
      const data = await loadAllUploadedHcpDatasets((p) => setDatasetProgress(p));
      applyLoadedHcpBundle(data, crosshair.mni);
    } catch (err) {
      console.error('Manual load of uploaded datasets failed:', err);
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
        console.log('[App] starting fetchAndParseMniVolume...');
        const vol = await fetchAndParseMniVolume();
        console.log('[App] setting volume in React state, dims:', vol.dims);
        setVolume(vol);
        setIsCustomVolume(true);
        console.log('[App] setVolume done');
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
      if (snapToSurface) {
        const nearest = findNearestSurfaceVertex(coord, activeSurfaces);
        if (nearest) {
          const vLabels =
            nearest.hemi === 'left' ? currentParcellation?.vertexLabelsL : currentParcellation?.vertexLabelsR;
          const labelKey = vLabels ? vLabels[nearest.vertexIndex] : undefined;
          const activeLabel =
            labelKey !== undefined ? currentParcellation?.labels.get(labelKey) : undefined;

          setCrosshair({
            mni: coord,
            nearestSurfacePoint: nearest.nearestPoint,
            surfaceDistance: nearest.distance,
            nearestVertexIndex: nearest.vertexIndex,
            nearestHemi: nearest.hemi,
            activeLabel,
            sourceView: source
          });
          return;
        }
      }

      setCrosshair((prev) => ({
        ...prev,
        mni: coord,
        sourceView: source
      }));
    },
    [snapToSurface, activeSurfaces, currentParcellation]
  );

  // Jump to specific landmark or manual coordinate
  const handleJumpToCoord = useCallback(
    (coord: WorldCoord) => {
      const nearest = findNearestSurfaceVertex(coord, activeSurfaces);
      if (nearest) {
        const vLabels =
          nearest.hemi === 'left' ? currentParcellation?.vertexLabelsL : currentParcellation?.vertexLabelsR;
        const labelKey = vLabels ? vLabels[nearest.vertexIndex] : undefined;
        const activeLabel =
          labelKey !== undefined ? currentParcellation?.labels.get(labelKey) : undefined;

        setCrosshair({
          mni: coord,
          nearestSurfacePoint: nearest.nearestPoint,
          surfaceDistance: nearest.distance,
          nearestVertexIndex: nearest.vertexIndex,
          nearestHemi: nearest.hemi,
          activeLabel,
          sourceView: 'manual'
        });
      } else {
        setCrosshair((prev) => ({
          ...prev,
          mni: coord,
          sourceView: 'manual'
        }));
      }
      // Always animate 3D view to the target coordinate
      focusSeqRef.current++;
      setSurfaceFocusTarget({ coord, seq: focusSeqRef.current });
    },
    [activeSurfaces, currentParcellation]
  );

  // Cross-section contour double-click: place fiducial marker and focus 3D view
  const handleContourDoubleClicked = useCallback(
    (hitCoord: WorldCoord, _surf: SurfaceMesh, _hemi: 'left' | 'right') => {
      focusSeqRef.current++;
      setSurfaceFocusTarget({ coord: hitCoord, seq: focusSeqRef.current });
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
    // Clear custom data and re-trigger auto-load of HCP reference data
    setLoadedParcellations({});
    setActiveParcId('glasser_hcp_mmp');
    setIsCustomLeftSurf(false);
    setIsCustomRightSurf(false);
    setIsCustomVolume(false);
    setIsCustomParc(false);
    // Re-load the default HCP datasets
    handleLoadAllUploadedDatasets();
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

      {/* Loading Overlay — visible during data fetch AND rendering initialization */}
      {showLoadingOverlay && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#09090B]/95 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 max-w-md px-6">
            <div className="w-10 h-10 border-2 border-[#38BDF8] border-t-transparent rounded-full animate-spin" />
            <div className="text-sm text-[#38BDF8] font-semibold tracking-wider uppercase">
              {datasetProgress?.step || 'Loading HCP datasets...'}
            </div>
            {datasetProgress && (
              <div className="w-64 h-1.5 bg-[#27272A] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#38BDF8] to-[#818CF8] rounded-full transition-all duration-300"
                  style={{ width: `${datasetProgress.percent}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Multi-Viewport Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left / Center Viewport Area based on selected Bento layout */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#000000] overflow-hidden">
          {layout === 'quad' && (
            <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 grid-rows-2 p-1.5 gap-1.5 bg-[#000000] overflow-hidden min-w-0 min-h-0">
              {/* Sagittal Slice Bento Cell */}
              <div className="bg-[#000000] border border-[#27272A] rounded-md relative overflow-hidden flex flex-col min-w-0 min-h-0">
                <ErrorBoundary fallbackTitle="Sagittal Cross-Section Error">
                  <CrossSectionViewer
                    volume={volume}
                    crosshair={crosshair.mni}
                    surfaces={activeSurfaces}
                    onSliceClicked={handleSliceClicked}
                    onSurfaceContourDoubleClicked={handleContourDoubleClicked}
                    activePlaneFocus="sagittal"
                    overlaySettings={overlaySettings}
                    onOverlaySettingsChange={setOverlaySettings}
                    onReady={() => handleViewerReady('slices')}
                  />
                </ErrorBoundary>
              </div>

              {/* Coronal Slice Bento Cell */}
              <div className="bg-[#000000] border border-[#27272A] rounded-md relative overflow-hidden flex flex-col min-w-0 min-h-0">
                <ErrorBoundary fallbackTitle="Coronal Cross-Section Error">
                  <CrossSectionViewer
                    volume={volume}
                    crosshair={crosshair.mni}
                    surfaces={activeSurfaces}
                    onSliceClicked={handleSliceClicked}
                    onSurfaceContourDoubleClicked={handleContourDoubleClicked}
                    activePlaneFocus="coronal"
                    overlaySettings={overlaySettings}
                    onOverlaySettingsChange={setOverlaySettings}
                  />
                </ErrorBoundary>
              </div>

              {/* Axial Slice Bento Cell */}
              <div className="bg-[#000000] border border-[#27272A] rounded-md relative overflow-hidden flex flex-col min-w-0 min-h-0">
                <ErrorBoundary fallbackTitle="Axial Cross-Section Error">
                  <CrossSectionViewer
                    volume={volume}
                    crosshair={crosshair.mni}
                    surfaces={activeSurfaces}
                    onSliceClicked={handleSliceClicked}
                    onSurfaceContourDoubleClicked={handleContourDoubleClicked}
                    activePlaneFocus="axial"
                    overlaySettings={overlaySettings}
                    onOverlaySettingsChange={setOverlaySettings}
                  />
                </ErrorBoundary>
              </div>

              {/* 3D Surface View Bento Cell */}
              <div className="bg-[#09090B] border border-[#38BDF8]/40 rounded-md relative overflow-hidden flex flex-col shadow-lg shadow-[#38BDF8]/5 min-w-0 min-h-0">
                <ErrorBoundary fallbackTitle="3D Cortex Surface Error">
                  <ThreeBrainViewer
                    leftSurface={leftSurface}
                    rightSurface={rightSurface}
                    parcellation={currentParcellation}
                    activeColorMode={activeColorMode}
                    crosshair={crosshair}
                    onSurfacePointClicked={handleSurfacePointClicked}
                    showMarkerOnSurface={true}
                    focusTarget={surfaceFocusTarget}
                    onReady={() => handleViewerReady('surface3d')}
                  />
                </ErrorBoundary>
              </div>
            </main>
          )}

          {layout === 'surface_focus' && (
            <div className="flex-1 p-1.5 bg-[#000000] overflow-hidden min-w-0 min-h-0">
              <div className="w-full h-full bg-[#09090B] border border-[#38BDF8]/40 rounded-md overflow-hidden flex flex-col shadow-xl min-w-0 min-h-0">
                <ErrorBoundary fallbackTitle="3D Cortex Surface Error">
                  <ThreeBrainViewer
                    leftSurface={leftSurface}
                    rightSurface={rightSurface}
                    parcellation={currentParcellation}
                    activeColorMode={activeColorMode}
                    crosshair={crosshair}
                    onSurfacePointClicked={handleSurfacePointClicked}
                    showMarkerOnSurface={true}
                    focusTarget={surfaceFocusTarget}
                    onReady={() => handleViewerReady('surface3d')}
                  />
                </ErrorBoundary>
              </div>
            </div>
          )}

          {layout === 'slices_focus' && (
            <div className="flex-1 p-1.5 bg-[#000000] overflow-hidden min-w-0 min-h-0">
              <div className="w-full h-full bg-[#000000] border border-[#27272A] rounded-md overflow-hidden flex flex-col min-w-0 min-h-0">
                <ErrorBoundary fallbackTitle="Cross-Section Viewer Error">
                  <CrossSectionViewer
                    volume={volume}
                    crosshair={crosshair.mni}
                    surfaces={activeSurfaces}
                    onSliceClicked={handleSliceClicked}
                    onSurfaceContourDoubleClicked={handleContourDoubleClicked}
                    activePlaneFocus="all"
                    overlaySettings={overlaySettings}
                    onOverlaySettingsChange={setOverlaySettings}
                    onReady={() => handleViewerReady('slices')}
                  />
                </ErrorBoundary>
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
            MNI: <span className="text-white font-mono font-medium">{crosshair.mni.x.toFixed(0)}, {crosshair.mni.y.toFixed(0)}, {crosshair.mni.z.toFixed(0)}</span>
          </span>
          {crosshair.activeLabel && (
            <span className="hidden md:inline truncate">
              LABEL: <span className="text-[#38BDF8] font-bold">{crosshair.activeLabel.name}</span>
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#71717A] font-mono uppercase tracking-tight shrink-0 hidden lg:block">
          SURFACE ATLAS: <span className="text-[#A1A1AA]">{currentParcellation?.name || (isDataReady ? 'None' : 'Loading...')}</span>
        </div>
      </footer>

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
