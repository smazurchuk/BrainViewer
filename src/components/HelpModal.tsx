import React from 'react';
import { X, MousePointerClick, Brain, Compass, Layers, CheckCircle2 } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-[#09090B] border border-[#27272A] rounded-lg max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#27272A] bg-[#09090B]">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-[#38BDF8]" />
            <h2 className="font-bold text-[#FAFAFA] text-xs uppercase tracking-wider">
              wb_view Bi-Directional Mapping Guide
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#71717A] hover:text-white rounded hover:bg-[#18181B] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs text-[#A1A1AA] leading-relaxed">
          <div className="bg-[#18181B] border border-[#27272A] rounded p-3">
            <h3 className="font-bold text-[#38BDF8] text-xs uppercase tracking-wider mb-1">
              Interactive Surface &amp; Volume Cross-Referencing
            </h3>
            <p className="text-[#A1A1AA] text-[11px]">
              This web app implements true bi-directional synchronization between 3D cortical meshes and 2D multi-planar volumetric MRI cross-sections in standard MNI stereotaxic space (AC-PC coordinates in mm).
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded bg-[#18181B] border border-[#27272A] text-[#38BDF8] shrink-0 mt-0.5">
                <MousePointerClick className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-[#FAFAFA] block text-xs mb-0.5">
                  1. Click 3D Surface → Centers Cross-Sections
                </strong>
                <p className="text-[#71717A] text-[11px]">
                  Click anywhere on the 3D cortical hemisphere. The app calculates the exact MNI coordinate `(X, Y, Z)` and vertex ID, and immediately re-centers all three volumetric orthogonal slices (Axial, Coronal, Sagittal) onto that coordinate.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded bg-[#18181B] border border-[#27272A] text-rose-400 shrink-0 mt-0.5">
                <Compass className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-[#FAFAFA] block text-xs mb-0.5">
                  2. Click or Double-Click Slice → Places 3D Marker on Surface
                </strong>
                <p className="text-[#71717A] text-[11px]">
                  Click or drag within any 2D cross-section slice. A 3D pulsing marker is placed at that exact volumetric point. If clicked near the cortex, it snaps to the nearest surface vertex, displays a connecting link, and measures the cortical distance in millimetres.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded bg-[#18181B] border border-[#27272A] text-purple-400 shrink-0 mt-0.5">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-[#FAFAFA] block text-xs mb-0.5">
                  3. Parcellations &amp; Surface Contours
                </strong>
                <p className="text-[#71717A] text-[11px]">
                  Toggle between Glasser HCP MMP 1.0 (180 areas), Brodmann Cytoarchitecture, and Yeo Resting-State Networks. The MRI cross-sections also display optional real-time cortical contours tracing where the 3D surface cuts through the slice.
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-[#27272A] pt-3">
            <h4 className="text-[10px] font-bold text-[#71717A] uppercase tracking-[0.2em] mb-2">Pre-Configured HCP Compatibility:</h4>
            <ul className="space-y-1 text-[11px] font-mono text-[#71717A]">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>S1200.L.pial_MSMAll.32k_fs_LR.surf.gii</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>S1200.R.pial_MSMAll.32k_fs_LR.surf.gii</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>MNI152_T1_0.7mm.nii.gz</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Q1-Q6_RelatedValidation210.CorticalAreas...dlabel.nii</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Human.Brodmann09.32k_fs_LR.dlabel.nii</span>
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Yeo7_RSN.32k_fs_LR.dlabel.nii</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-5 py-3 border-t border-[#27272A] bg-[#09090B]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#38BDF8] hover:bg-[#38BDF8]/90 text-black font-semibold rounded transition-colors text-xs uppercase tracking-wider"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
