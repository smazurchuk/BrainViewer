import React, { useEffect, useRef } from 'react';
import {
  Crosshair,
  Layers,
  Compass,
  Palette,
  SunMedium,
  Target,
  Check,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { ViewerOverlaySettings, WorldCoord, ColormapType } from '../neuro/types';

export interface ContextMenuTarget {
  x: number;
  y: number;
  plane: 'axial' | 'coronal' | 'sagittal';
  coord: WorldCoord;
}

interface OverlayContextMenuProps {
  target: ContextMenuTarget;
  overlaySettings: ViewerOverlaySettings;
  onUpdateSettings: (updater: (prev: ViewerOverlaySettings) => ViewerOverlaySettings) => void;
  onCenterCrosshair: (coord: WorldCoord) => void;
  onResetZoomPan?: () => void;
  onClose: () => void;
}

const COLORMAPS: { id: ColormapType; label: string; previewClass: string }[] = [
  { id: 'grayscale', label: 'Grayscale (T1 Standard)', previewClass: 'from-black via-zinc-400 to-white' },
  { id: 'inverted', label: 'Inverted (CT / X-Ray)', previewClass: 'from-white via-zinc-400 to-black' },
  { id: 'hot', label: 'Hot / Iron (Heatmap)', previewClass: 'from-black via-red-600 via-amber-400 to-white' },
  { id: 'bone', label: 'Bone (High Contrast)', previewClass: 'from-black via-blue-950 via-amber-100 to-white' },
  { id: 'jet', label: 'Jet (Rainbow)', previewClass: 'from-blue-600 via-emerald-400 via-amber-400 to-red-600' }
];

const PRESETS = [
  { label: 'Standard Brain', widthFactor: 1.0, levelFactor: 0.5 },
  { label: 'High Contrast', widthFactor: 0.55, levelFactor: 0.58 },
  { label: 'Bone / Skull', widthFactor: 0.8, levelFactor: 0.8 },
  { label: 'Soft Tissue', widthFactor: 0.7, levelFactor: 0.45 }
];

const LANDMARKS: { name: string; coord: WorldCoord }[] = [
  { name: 'Motor Hand Knob (M1)', coord: { x: -38, y: -22, z: 56 } },
  { name: "Broca's Area (BA 44)", coord: { x: -50, y: 16, z: 18 } },
  { name: 'Primary Visual (V1)', coord: { x: -12, y: -86, z: 4 } },
  { name: 'Primary Auditory (A1)', coord: { x: -48, y: -18, z: 8 } }
];

export const OverlayContextMenu: React.FC<OverlayContextMenuProps> = ({
  target,
  overlaySettings,
  onUpdateSettings,
  onCenterCrosshair,
  onResetZoomPan,
  onClose
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handleDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Clamp positioning inside the viewport
  const menuWidth = 260;
  const menuHeight = 440;
  const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 12, target.x));
  const top = Math.max(8, Math.min(window.innerHeight - menuHeight - 12, target.y));

  return (
    <div
      ref={menuRef}
      style={{ left: `${left}px`, top: `${top}px` }}
      className="fixed z-50 w-[260px] max-h-[92vh] overflow-y-auto bg-[#09090B]/95 backdrop-blur-md border border-[#27272A] rounded-lg shadow-2xl shadow-black/80 py-1.5 text-xs text-[#FAFAFA] select-none animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Menu Header with Clicked Location */}
      <div className="px-3 py-1.5 border-b border-[#27272A] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span className="font-bold text-[11px] uppercase tracking-wider text-[#FAFAFA]">
            Overlay Options
          </span>
        </div>
        <span className="text-[10px] font-mono text-[#71717A] uppercase">
          {target.plane}
        </span>
      </div>

      {/* Center Crosshairs Button */}
      <button
        type="button"
        onClick={() => {
          onCenterCrosshair(target.coord);
          onClose();
        }}
        className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#18181B] text-left transition-colors border-b border-[#27272A]/60 group"
      >
        <div className="flex items-center gap-2">
          <Crosshair className="w-3.5 h-3.5 text-[#38BDF8] group-hover:scale-110 transition-transform" />
          <span className="text-[11px] font-medium text-[#38BDF8]">Center Crosshair Here</span>
        </div>
        <span className="font-mono text-[10px] text-[#71717A]">
          {target.coord.x.toFixed(0)}, {target.coord.y.toFixed(0)}, {target.coord.z.toFixed(0)}
        </span>
      </button>

      {/* View Reset */}
      {onResetZoomPan && (
        <div className="py-1 px-1 border-b border-[#27272A]/60">
          <button
            type="button"
            onClick={() => {
              onResetZoomPan();
              onClose();
            }}
            className="w-full px-2 py-1.5 rounded flex items-center justify-between hover:bg-[#18181B] text-left transition-colors text-[#A1A1AA] hover:text-[#38BDF8]"
          >
            <div className="flex items-center gap-2">
              <RotateCcw className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span className="text-[11px] font-medium">Reset Pan (Center View)</span>
            </div>
          </button>
        </div>
      )}

      {/* Toggles Group */}
      <div className="py-1 px-1 border-b border-[#27272A]/60 space-y-0.5">
        {/* Toggle Crosshairs */}
        <button
          type="button"
          onClick={() => {
            onUpdateSettings((prev) => ({ ...prev, showCrosshairs: !prev.showCrosshairs }));
          }}
          className="w-full px-2 py-1 rounded flex items-center justify-between hover:bg-[#18181B] text-left transition-colors"
        >
          <div className="flex items-center gap-2">
            <Crosshair className="w-3.5 h-3.5 text-[#A1A1AA]" />
            <span className="text-[11px]">Show Crosshairs</span>
          </div>
          {overlaySettings.showCrosshairs && <Check className="w-3.5 h-3.5 text-[#38BDF8]" />}
        </button>

        {/* Toggle Cortical Contours */}
        <button
          type="button"
          onClick={() => {
            onUpdateSettings((prev) => ({ ...prev, showSurfaceContours: !prev.showSurfaceContours }));
          }}
          className="w-full px-2 py-1 rounded flex items-center justify-between hover:bg-[#18181B] text-left transition-colors"
        >
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-[#A1A1AA]" />
            <span className="text-[11px]">Cortical Surface Contours</span>
          </div>
          {overlaySettings.showSurfaceContours && <Check className="w-3.5 h-3.5 text-[#38BDF8]" />}
        </button>

        {/* Toggle Orientation Labels */}
        <button
          type="button"
          onClick={() => {
            onUpdateSettings((prev) => ({ ...prev, showOrientationLabels: !prev.showOrientationLabels }));
          }}
          className="w-full px-2 py-1 rounded flex items-center justify-between hover:bg-[#18181B] text-left transition-colors"
        >
          <div className="flex items-center gap-2">
            <Compass className="w-3.5 h-3.5 text-[#A1A1AA]" />
            <span className="text-[11px]">Orientation Markers (A/P/L/R/S/I)</span>
          </div>
          {overlaySettings.showOrientationLabels && <Check className="w-3.5 h-3.5 text-[#38BDF8]" />}
        </button>
      </div>

      {/* Colormap Selection */}
      <div className="py-1 px-1 border-b border-[#27272A]/60">
        <div className="px-2 py-0.5 text-[9px] font-bold text-[#71717A] uppercase tracking-wider flex items-center gap-1.5">
          <Palette className="w-3 h-3" />
          <span>Colormap (Synchronized)</span>
        </div>
        <div className="mt-0.5 space-y-0.5">
          {COLORMAPS.map((cm) => (
            <button
              key={cm.id}
              type="button"
              onClick={() => {
                onUpdateSettings((prev) => ({ ...prev, colormap: cm.id }));
              }}
              className={`w-full px-2 py-1 rounded flex items-center justify-between text-left transition-colors ${
                overlaySettings.colormap === cm.id
                  ? 'bg-[#18181B] text-[#38BDF8] font-semibold'
                  : 'hover:bg-[#18181B] text-[#D4D4D8]'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className={`w-3.5 h-2.5 rounded-sm bg-gradient-to-r ${cm.previewClass} border border-white/20`} />
                <span className="text-[11px]">{cm.label}</span>
              </div>
              {overlaySettings.colormap === cm.id && <Check className="w-3.5 h-3.5 text-[#38BDF8]" />}
            </button>
          ))}
        </div>
      </div>

      {/* Window / Level Presets */}
      <div className="py-1 px-1 border-b border-[#27272A]/60">
        <div className="px-2 py-0.5 text-[9px] font-bold text-[#71717A] uppercase tracking-wider flex items-center gap-1.5">
          <SunMedium className="w-3 h-3" />
          <span>Contrast Presets</span>
        </div>
        <div className="grid grid-cols-2 gap-1 mt-1 px-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                onUpdateSettings((prev) => ({
                  ...prev,
                  windowWidth: Math.round(prev.windowWidth * preset.widthFactor),
                  windowLevel: Math.round(prev.windowLevel * preset.levelFactor)
                }));
              }}
              className="px-2 py-1 bg-[#18181B] hover:bg-[#27272A] border border-[#27272A] rounded text-[10px] text-center text-[#D4D4D8] hover:text-white transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Landmark Jump */}
      <div className="py-1 px-1">
        <div className="px-2 py-0.5 text-[9px] font-bold text-[#71717A] uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-[#38BDF8]" />
          <span>Jump to Landmark</span>
        </div>
        <div className="mt-0.5 space-y-0.5">
          {LANDMARKS.map((lm) => (
            <button
              key={lm.name}
              type="button"
              onClick={() => {
                onCenterCrosshair(lm.coord);
                onClose();
              }}
              className="w-full px-2 py-1 rounded flex items-center justify-between hover:bg-[#18181B] text-left transition-colors text-[10px] text-[#A1A1AA] hover:text-white"
            >
              <span>{lm.name}</span>
              <span className="font-mono text-[9px] text-[#71717A]">
                {lm.coord.x}, {lm.coord.y}, {lm.coord.z}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
