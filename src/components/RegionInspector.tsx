import React, { useState } from 'react';
import { CrosshairState, WorldCoord, Parcellation } from '../neuro/types';
import {
  MapPin,
  Brain,
  Compass,
  Activity,
  Bookmark,
  ChevronRight,
  Info
} from 'lucide-react';

interface RegionInspectorProps {
  crosshair: CrosshairState;
  parcellation: Parcellation | null;
  onJumpToCoord: (coord: WorldCoord) => void;
}

interface Landmark {
  name: string;
  category: string;
  coord: WorldCoord;
  description: string;
}

const LANDMARKS: Landmark[] = [
  {
    name: "Hand Knob (M1) — L",
    category: 'Motor',
    coord: { x: -38, y: -22, z: 56 },
    description: 'Primary motor cortex hand representation'
  },
  {
    name: "Broca's Area (BA 44) — L",
    category: 'Language',
    coord: { x: -50, y: 16, z: 18 },
    description: 'Inferior frontal gyrus pars opercularis'
  },
  {
    name: "Primary Visual (V1) — L",
    category: 'Visual',
    coord: { x: -12, y: -86, z: 4 },
    description: 'Calcarine sulcus primary visual cortex'
  },
  {
    name: "Primary Auditory (A1) — L",
    category: 'Auditory',
    coord: { x: -48, y: -18, z: 8 },
    description: "Heschl's gyrus primary auditory cortex"
  },
  {
    name: 'Frontal Eye Field (FEF) — L',
    category: 'Attention',
    coord: { x: -32, y: -4, z: 52 },
    description: 'Saccadic eye movement control center'
  },
  {
    name: 'Dorsolateral PFC (Area 46) — L',
    category: 'Executive',
    coord: { x: -42, y: 36, z: 24 },
    description: 'Working memory and cognitive control'
  },
  {
    name: 'Precuneus (DMN Hub) — L',
    category: 'Default Mode',
    coord: { x: -6, y: -56, z: 36 },
    description: 'Posterior hub of Default Mode Network'
  },
  {
    name: 'Anterior Insula (AVI) — L',
    category: 'Salience',
    coord: { x: -34, y: 16, z: 2 },
    description: 'Salience network and interoceptive hub'
  }
];

export const RegionInspector: React.FC<RegionInspectorProps> = ({
  crosshair,
  parcellation,
  onJumpToCoord
}) => {
  const [manualX, setManualX] = useState<string>(crosshair.mni.x.toFixed(0));
  const [manualY, setManualY] = useState<string>(crosshair.mni.y.toFixed(0));
  const [manualZ, setManualZ] = useState<string>(crosshair.mni.z.toFixed(0));

  // Sync inputs with external coordinate changes
  React.useEffect(() => {
    setManualX(crosshair.mni.x.toFixed(0));
    setManualY(crosshair.mni.y.toFixed(0));
    setManualZ(crosshair.mni.z.toFixed(0));
  }, [crosshair.mni.x, crosshair.mni.y, crosshair.mni.z]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const x = parseFloat(manualX);
    const y = parseFloat(manualY);
    const z = parseFloat(manualZ);
    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
      onJumpToCoord({ x, y, z });
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#09090B] border-l border-[#27272A] text-[#FAFAFA] text-xs overflow-y-auto">
      {/* Title Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-[#09090B] border-b border-[#27272A]">
        <div className="flex items-center gap-1.5 font-semibold text-[#FAFAFA]">
          <Compass className="w-4 h-4 text-[#38BDF8]" />
          <span className="text-[11px] font-bold uppercase tracking-wider">Region Inspector</span>
        </div>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#18181B] text-[#38BDF8] font-mono border border-[#27272A]">
          MNI152 Space
        </span>
      </div>

      {/* MNI Coordinates Card */}
      <div className="p-3 border-b border-[#27272A] bg-[#09090B]">
        <div className="text-[10px] font-bold text-[#71717A] uppercase tracking-[0.2em] mb-2 flex items-center justify-between">
          <span>Active Coordinate</span>
          <span className="text-[#71717A] font-normal lowercase tracking-normal">via {crosshair.sourceView}</span>
        </div>

        <form onSubmit={handleManualSubmit} className="grid grid-cols-3 gap-1.5 mb-2">
          <div className="bg-black border border-[#27272A] rounded p-1.5 text-center">
            <span className="text-[9px] font-bold text-[#71717A] uppercase block">X (L/R)</span>
            <input
              type="number"
              step="0.5"
              value={manualX}
              onChange={(e) => setManualX(e.target.value)}
              className="w-full bg-transparent text-xs font-mono text-center text-[#FAFAFA] focus:outline-none focus:text-[#38BDF8]"
            />
          </div>
          <div className="bg-black border border-[#27272A] rounded p-1.5 text-center">
            <span className="text-[9px] font-bold text-[#71717A] uppercase block">Y (P/A)</span>
            <input
              type="number"
              step="0.5"
              value={manualY}
              onChange={(e) => setManualY(e.target.value)}
              className="w-full bg-transparent text-xs font-mono text-center text-[#FAFAFA] focus:outline-none focus:text-[#38BDF8]"
            />
          </div>
          <div className="bg-black border border-[#27272A] rounded p-1.5 text-center">
            <span className="text-[9px] font-bold text-[#71717A] uppercase block">Z (I/S)</span>
            <input
              type="number"
              step="0.5"
              value={manualZ}
              onChange={(e) => setManualZ(e.target.value)}
              className="w-full bg-transparent text-xs font-mono text-center text-[#FAFAFA] focus:outline-none focus:text-[#38BDF8]"
            />
          </div>
        </form>

        <button
          type="button"
          onClick={() => handleManualSubmit({} as any)}
          className="w-full py-1 bg-[#18181B] hover:bg-[#27272A] text-[#FAFAFA] font-medium border border-[#27272A] rounded transition-colors text-[10px] uppercase tracking-wider"
        >
          Center Crosshairs
        </button>
      </div>

      {/* Parcellation & Anatomical Label Card */}
      <div className="p-3 border-b border-[#27272A]">
        <div className="text-[10px] font-bold text-[#71717A] uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span>Active Parcellation Area</span>
        </div>

        {crosshair.activeLabel ? (
          (() => {
            const labelColor = crosshair.activeLabel.color || [0.6, 0.6, 0.6];
            return (
              <div className="bg-[#18181B] border border-[#27272A] rounded p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/20"
                    style={{
                      backgroundColor: `rgb(${Math.round(labelColor[0] * 255)}, ${Math.round(
                        labelColor[1] * 255
                      )}, ${Math.round(labelColor[2] * 255)})`
                    }}
                  />
                  <div className="min-w-0">
                    <div className="font-bold text-[#FAFAFA] text-xs truncate">
                      {crosshair.activeLabel.name}
                    </div>
                    {crosshair.activeLabel.network && (
                      <div className="text-[10px] text-[#38BDF8] font-medium">
                        Network: {crosshair.activeLabel.network}
                      </div>
                    )}
                  </div>
                </div>

                {crosshair.activeLabel.description && (
                  <p className="text-[11px] text-[#A1A1AA] leading-relaxed bg-black/40 p-2 rounded border border-[#27272A]">
                    {crosshair.activeLabel.description}
                  </p>
                )}
              </div>
            );
          })()
        ) : (
          <div className="bg-[#18181B] border border-[#27272A] rounded p-3 text-center text-[#71717A] text-[11px]">
            Click on cortical surface or cross-section near the surface to inspect area.
          </div>
        )}
      </div>

      {/* Anatomical Landmarks & Bookmarks */}
      <div className="p-3 flex-1">
        <div className="text-[10px] font-bold text-[#71717A] uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5">
          <Bookmark className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span>Canonical Landmarks</span>
        </div>

        <div className="space-y-1.5">
          {LANDMARKS.map((lm, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onJumpToCoord(lm.coord)}
              className="w-full text-left p-2 rounded bg-[#18181B] hover:bg-[#27272A] border border-[#27272A] transition-all group"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-medium text-[#FAFAFA] group-hover:text-[#38BDF8] transition-colors text-[11px]">
                  {lm.name}
                </span>
                <span className="text-[9px] px-1 py-0.2 rounded bg-black text-[#71717A] uppercase border border-[#27272A]">
                  {lm.category}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#71717A] font-mono">
                <span>
                  [{lm.coord.x}, {lm.coord.y}, {lm.coord.z}]
                </span>
                <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform text-[#A1A1AA]" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Interaction Hint */}
      <div className="mt-auto px-3 py-3 border-t border-[#27272A]">
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-[#18181B] border border-[#27272A]">
          <span className="text-sm shrink-0 mt-0.5">💡</span>
          <span className="text-[11px] text-[#A1A1AA] leading-relaxed">
            Try <span className="text-[#38BDF8] font-semibold">double-clicking</span> on the 3D surface or a cross-section surface contour!
          </span>
        </div>
      </div>
    </div>
  );
};
