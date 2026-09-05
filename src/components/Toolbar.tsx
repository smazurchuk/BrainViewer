import React from 'react';
import {
  Brain,
  LayoutGrid,
  Maximize2,
  Columns,
  Square,
  FolderOpen,
  Crosshair,
  Info,
  Layers,
  Sparkles
} from 'lucide-react';
import { ViewLayout } from '../neuro/types';

interface ToolbarProps {
  layout: ViewLayout;
  onLayoutChange: (layout: ViewLayout) => void;
  selectedParcellationId: string;
  onParcellationChange: (id: string) => void;
  parcellationOptions?: { id: string; name: string }[];
  activeColorMode: 'parcellation' | 'curvature' | 'solid';
  onColorModeChange: (mode: 'parcellation' | 'curvature' | 'solid') => void;
  snapToSurface: boolean;
  onToggleSnapToSurface: () => void;
  onOpenFileManager: () => void;
  onOpenHelp: () => void;
  hasCustomFiles: boolean;
  onLoadUploadedDataset?: () => void;
  isLoadingUploaded?: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  layout,
  onLayoutChange,
  selectedParcellationId,
  onParcellationChange,
  parcellationOptions = [
    { id: 'glasser_hcp_mmp', name: 'Glasser HCP-MMP1.0 (360 Areas)' },
    { id: 'brodmann_atlas', name: 'Brodmann BA09 (32k_fs_LR)' },
    { id: 'yeo_rsn_networks', name: 'RSN-networks (Yeo 7/17)' }
  ],
  activeColorMode,
  onColorModeChange,
  snapToSurface,
  onToggleSnapToSurface,
  onOpenFileManager,
  onOpenHelp,
  hasCustomFiles,
  onLoadUploadedDataset,
  isLoadingUploaded
}) => {
  return (
    <header className="h-12 border-b border-[#27272A] bg-[#09090B] text-[#FAFAFA] flex items-center px-4 justify-between select-none shrink-0 z-20">
      {/* Brand & Identity */}
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 bg-[#38BDF8] rounded-sm flex items-center justify-center shrink-0 shadow-sm shadow-[#38BDF8]/20">
          <div className="w-3 h-3 border-2 border-black rounded-full" />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-bold tracking-tight text-sm text-[#FAFAFA]">
            CONNECTOME <span className="text-[#71717A] font-medium text-xs">WORKBENCH</span>
          </span>
        </div>
      </div>

      {/* Center Controls: Parcellation, Surface Snap, and HCP Loader */}
      <div className="flex items-center gap-2.5 text-[11px] font-medium">
        {onLoadUploadedDataset && !hasCustomFiles && (
          <button
            type="button"
            onClick={onLoadUploadedDataset}
            disabled={isLoadingUploaded}
            title="Load the 6 uploaded canonical HCP datasets (S1200 Pial Surfaces, MNI152 0.7mm, Glasser, Brodmann, RSN)"
            className="flex items-center gap-1.5 px-3 py-1 bg-[#38BDF8]/15 hover:bg-[#38BDF8]/25 text-[#38BDF8] border border-[#38BDF8]/40 rounded text-xs font-semibold transition-all shadow-sm shadow-[#38BDF8]/10"
          >
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span className="text-[10px] tracking-wider uppercase">
              {isLoadingUploaded ? 'Loading HCP Files...' : 'Load Uploaded HCP Datasets'}
            </span>
          </button>
        )}

        <div className="flex items-center gap-2 bg-[#18181B] border border-[#27272A] rounded px-2.5 py-1 text-xs">
          <span className="text-[10px] font-bold text-[#71717A] uppercase tracking-wider">Atlas:</span>
          <select
            value={activeColorMode === 'parcellation' ? selectedParcellationId : activeColorMode}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'curvature') {
                onColorModeChange('curvature');
              } else if (val === 'solid') {
                onColorModeChange('solid');
              } else {
                onColorModeChange('parcellation');
                onParcellationChange(val);
              }
            }}
            className="bg-transparent text-[#FAFAFA] text-xs font-medium focus:outline-none cursor-pointer max-w-[200px] truncate"
          >
            <optgroup label="Parcellations">
              {parcellationOptions.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-[#18181B]">
                  {opt.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Surface Overlays">
              <option value="curvature" className="bg-[#18181B]">
                Sulcal Curvature (Pial Folds)
              </option>
              <option value="solid" className="bg-[#18181B]">
                Solid Anatomical
              </option>
            </optgroup>
          </select>
        </div>

        {/* Snap to Surface toggle */}
        <button
          type="button"
          onClick={onToggleSnapToSurface}
          title="When enabled, slice clicks automatically calculate nearest cortical vertex"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
            snapToSurface
              ? 'bg-[#38BDF8]/10 text-[#38BDF8] border-[#38BDF8]/40'
              : 'bg-[#18181B] text-[#71717A] border-[#27272A] hover:text-[#FAFAFA]'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span className="hidden sm:inline uppercase text-[10px] tracking-wider font-semibold">Surface Snap</span>
        </button>
      </div>

      {/* Right Controls: Files, Layout & System Badge */}
      <div className="flex items-center gap-3 text-[11px] font-medium text-[#A1A1AA] uppercase tracking-wider">
        {/* Layout Switcher */}
        <div className="flex items-center bg-[#18181B] border border-[#27272A] rounded p-0.5">
          <button
            type="button"
            title="Quad Bento View"
            onClick={() => onLayoutChange('quad')}
            className={`p-1 rounded transition-colors ${
              layout === 'quad' ? 'bg-[#38BDF8] text-black' : 'text-[#71717A] hover:text-[#FAFAFA]'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="3D Surface Focus"
            onClick={() => onLayoutChange('surface_focus')}
            className={`p-1 rounded transition-colors ${
              layout === 'surface_focus' ? 'bg-[#38BDF8] text-black' : 'text-[#71717A] hover:text-[#FAFAFA]'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Cross-Section Focus"
            onClick={() => onLayoutChange('slices_focus')}
            className={`p-1 rounded transition-colors ${
              layout === 'slices_focus' ? 'bg-[#38BDF8] text-black' : 'text-[#71717A] hover:text-[#FAFAFA]'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Files Button */}
        <button
          type="button"
          onClick={onOpenFileManager}
          className="relative flex items-center gap-1.5 px-2.5 py-1 bg-[#18181B] hover:bg-[#27272A] text-[#38BDF8] border border-[#27272A] rounded text-xs transition-colors"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span className="font-semibold text-[10px] tracking-wider">FILES</span>
          {hasCustomFiles && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8] absolute -top-0.5 -right-0.5 animate-pulse" />
          )}
        </button>

        <div className="h-4 w-[1px] bg-[#27272A] hidden md:block" />

        {/* MNI152 Coordinate System Badge */}
        <div className="hidden md:flex items-center gap-1.5 text-[10px]">
          <span className="text-[#71717A]">COORD:</span>
          <span className="text-[#FAFAFA] font-mono font-bold bg-[#18181B] px-1.5 py-0.5 rounded border border-[#27272A]">
            MNI152
          </span>
        </div>

        {/* Help */}
        <button
          type="button"
          onClick={onOpenHelp}
          title="Guide & Feature Info"
          className="p-1 text-[#71717A] hover:text-[#FAFAFA] hover:bg-[#18181B] rounded transition-colors"
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
