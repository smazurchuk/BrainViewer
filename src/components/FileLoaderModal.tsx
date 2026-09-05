import React, { useState } from 'react';
import {
  Upload,
  FileCheck,
  Brain,
  Layers,
  Box,
  CheckCircle2,
  AlertCircle,
  X,
  FileText,
  RefreshCw,
  FolderOpen,
  Sparkles,
  DownloadCloud
} from 'lucide-react';
import { parseGiftiSurface } from '../neuro/giftiParser';
import { parseNiftiVolume } from '../neuro/niftiParser';
import { parseCiftiFile } from '../neuro/ciftiParser';
import { SurfaceMesh, VolumeData, Parcellation } from '../neuro/types';
import {
  UPLOADED_FILES_MANIFEST,
  UploadedDatasetProgress
} from '../neuro/datasetLoader';

interface FileLoaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSurfaceLoaded: (surf: SurfaceMesh) => void;
  onVolumeLoaded: (vol: VolumeData) => void;
  onParcellationLoaded: (parc: Parcellation) => void;
  onResetDefaults: () => void;
  onLoadAllUploadedDatasets?: () => Promise<void>;
  onLoadSingleUploadedDataset?: (fileKey: keyof typeof UPLOADED_FILES_MANIFEST) => Promise<void>;
  datasetProgress?: UploadedDatasetProgress | null;
  isDatasetLoading?: boolean;
  loadedFileStatuses: {
    leftSurfName: string;
    rightSurfName: string;
    volumeName: string;
    parcellationName: string;
    isCustomLeftSurf: boolean;
    isCustomRightSurf: boolean;
    isCustomVolume: boolean;
    isCustomParc: boolean;
  };
}

export const FileLoaderModal: React.FC<FileLoaderModalProps> = ({
  isOpen,
  onClose,
  onSurfaceLoaded,
  onVolumeLoaded,
  onParcellationLoaded,
  onResetDefaults,
  onLoadAllUploadedDatasets,
  onLoadSingleUploadedDataset,
  datasetProgress,
  isDatasetLoading = false,
  loadedFileStatuses
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const processFile = async (file: File) => {
    setLoadingMessage(`Parsing ${file.name}...`);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const lowerName = file.name.toLowerCase();

      // 1. GIfTI Surface file (.surf.gii or .gii)
      if (lowerName.endsWith('.gii') || lowerName.endsWith('.surf.gii')) {
        const text = await file.text();
        const surf = parseGiftiSurface(text, file.name);
        onSurfaceLoaded(surf);
        setSuccessMessage(`Successfully loaded ${surf.hemi.toUpperCase()} surface: ${file.name}`);
      }
      // 2. CIFTI Parcellation file (.dlabel.nii or .dscalar.nii)
      else if (lowerName.includes('.dlabel.nii') || lowerName.includes('.dscalar.nii')) {
        const buffer = await file.arrayBuffer();
        const parc = parseCiftiFile(buffer, file.name);
        onParcellationLoaded(parc);
        setSuccessMessage(`Successfully loaded CIFTI parcellation: ${file.name}`);
      }
      // 3. Volumetric NIfTI file (.nii or .nii.gz)
      else if (lowerName.endsWith('.nii') || lowerName.endsWith('.nii.gz')) {
        const buffer = await file.arrayBuffer();
        // Check if it's actually CIFTI
        if (lowerName.includes('.dlabel.') || lowerName.includes('.dscalar.')) {
          const parc = parseCiftiFile(buffer, file.name);
          onParcellationLoaded(parc);
          setSuccessMessage(`Successfully loaded CIFTI: ${file.name}`);
        } else {
          const vol = parseNiftiVolume(buffer, file.name);
          onVolumeLoaded(vol);
          setSuccessMessage(`Successfully loaded 3D MRI Volume: ${file.name} [${vol.dims.join('x')}]`);
        }
      } else {
        throw new Error(`Unsupported file extension for ${file.name}. Expected .gii, .nii, or .nii.gz`);
      }
    } catch (err: any) {
      console.error('File parsing error:', err);
      setErrorMessage(`Error reading ${file.name}: ${err.message || err}`);
    } finally {
      setLoadingMessage(null);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      await processFile(files[i]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-[#09090B] border border-[#27272A] rounded-lg max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#27272A] bg-[#09090B]">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-[#38BDF8]" />
            <h2 className="font-bold text-[#FAFAFA] text-xs uppercase tracking-wider">
              Neuroimaging File Manager (wb_view)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#71717A] hover:text-white rounded hover:bg-[#18181B] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Status notices */}
          {datasetProgress && isDatasetLoading && (
            <div className="p-3 bg-[#18181B] border border-[#38BDF8]/40 rounded text-[#FAFAFA] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[#38BDF8] font-medium">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{datasetProgress.step}</span>
                </div>
                <span className="font-mono text-xs text-[#38BDF8]">{datasetProgress.percent}%</span>
              </div>
              <div className="w-full bg-[#27272A] h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-[#38BDF8] h-full transition-all duration-300 rounded-full"
                  style={{ width: `${datasetProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {loadingMessage && (
            <div className="flex items-center gap-2 p-3 bg-[#18181B] border border-[#38BDF8]/40 rounded text-[#38BDF8]">
              <RefreshCw className="w-4 h-4 animate-spin text-[#38BDF8]" />
              <span>{loadingMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center gap-2 p-3 bg-[#18181B] border border-rose-500/40 rounded text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="flex items-center gap-2 p-3 bg-[#18181B] border border-emerald-500/40 rounded text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Quick-Load Uploaded HCP Datasets */}
          <div className="p-4 rounded-lg bg-[#18181B] border border-[#38BDF8]/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#38BDF8]" />
                <span className="font-semibold text-[#FAFAFA] text-xs uppercase tracking-wider">
                  Uploaded HCP Reference Datasets (Ready to Load)
                </span>
              </div>
              <span className="text-[10px] text-[#38BDF8] bg-[#38BDF8]/10 px-2 py-0.5 rounded border border-[#38BDF8]/20 font-mono">
                6 Files Detected
              </span>
            </div>

            <p className="text-[#A1A1AA] text-[11px] leading-relaxed">
              The real HCP S1200 32k pial surfaces, MNI152 0.7mm volume, and CIFTI parcellations (Glasser MMP1.0, Brodmann BA09, RSN networks) have been uploaded to the workspace.
            </p>

            {onLoadAllUploadedDatasets && (
              <button
                type="button"
                disabled={isDatasetLoading}
                onClick={async () => {
                  setErrorMessage(null);
                  try {
                    await onLoadAllUploadedDatasets();
                    setSuccessMessage('Successfully loaded all 6 HCP datasets! Volume, Surfaces, and Parcellations are active.');
                  } catch (err: any) {
                    setErrorMessage(`Failed to load dataset: ${err.message}`);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-[#38BDF8] hover:bg-[#38BDF8]/90 disabled:opacity-50 text-black font-bold rounded transition-colors text-xs uppercase tracking-wider shadow-md shadow-[#38BDF8]/20"
              >
                {isDatasetLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Loading Datasets...</span>
                  </>
                ) : (
                  <>
                    <DownloadCloud className="w-4 h-4" />
                    <span>Load All 6 Uploaded Datasets (1-Click)</span>
                  </>
                )}
              </button>
            )}

            {/* Individual File Quick-Load Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
              {(Object.keys(UPLOADED_FILES_MANIFEST) as Array<keyof typeof UPLOADED_FILES_MANIFEST>).map((key) => {
                const item = UPLOADED_FILES_MANIFEST[key];
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={isDatasetLoading}
                    onClick={async () => {
                      if (!onLoadSingleUploadedDataset) return;
                      setErrorMessage(null);
                      try {
                        await onLoadSingleUploadedDataset(key);
                        setSuccessMessage(`Loaded ${item.title}`);
                      } catch (e: any) {
                        setErrorMessage(`Error loading ${item.title}: ${e.message}`);
                      }
                    }}
                    className="flex items-center justify-between p-2 rounded bg-black/40 hover:bg-black/70 border border-[#27272A] hover:border-[#38BDF8]/50 text-left transition-colors group"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-[11px] font-medium text-[#FAFAFA] truncate group-hover:text-[#38BDF8]">
                        {item.title}
                      </div>
                      <div className="text-[10px] text-[#71717A] truncate font-mono">
                        {item.filename}
                      </div>
                    </div>
                    <span className="text-[10px] text-[#71717A] font-mono shrink-0">
                      {item.size}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Drag & Drop Upload Zone for Additional Files */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border border-dashed rounded p-4 text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
              isDragging
                ? 'border-[#38BDF8] bg-[#38BDF8]/10'
                : 'border-[#27272A] hover:border-[#38BDF8] bg-black/40'
            }`}
            onClick={() => document.getElementById('file-upload-input')?.click()}
          >
            <Upload className="w-5 h-5 text-[#38BDF8] mb-1.5" />
            <p className="font-semibold text-[#FAFAFA] text-xs mb-0.5">
              Upload Additional Neuroimaging Files
            </p>
            <p className="text-[#71717A] text-[10px] max-w-md">
              Drag & drop any custom <code className="text-[#38BDF8]">.surf.gii</code>, <code className="text-[#38BDF8]">.nii.gz</code>, or <code className="text-[#38BDF8]">.dlabel.nii</code>
            </p>
            <input
              id="file-upload-input"
              type="file"
              multiple
              accept=".gii,.nii,.gz"
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
            />
          </div>

          {/* Active File Slots */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold text-[#71717A] uppercase tracking-[0.2em]">
              Active HCP Workbench Slots
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {/* Left Surface */}
              <div className="p-2.5 rounded bg-[#18181B] border border-[#27272A] flex items-start justify-between">
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5 font-medium text-[#FAFAFA]">
                    <Brain className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
                    <span className="truncate">S1200.L.pial_MSMAll.32k_fs_LR</span>
                  </div>
                  <div className="text-[11px] text-[#71717A] mt-0.5 truncate font-mono">
                    Active: {loadedFileStatuses.leftSurfName}
                  </div>
                </div>
                <span
                  className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0 border ${
                    loadedFileStatuses.isCustomLeftSurf
                      ? 'bg-black text-emerald-400 border-emerald-500/40'
                      : 'bg-black text-[#71717A] border-[#27272A]'
                  }`}
                >
                  {loadedFileStatuses.isCustomLeftSurf ? 'Uploaded' : 'Canonical'}
                </span>
              </div>

              {/* Right Surface */}
              <div className="p-2.5 rounded bg-[#18181B] border border-[#27272A] flex items-start justify-between">
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5 font-medium text-[#FAFAFA]">
                    <Brain className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
                    <span className="truncate">S1200.R.pial_MSMAll.32k_fs_LR</span>
                  </div>
                  <div className="text-[11px] text-[#71717A] mt-0.5 truncate font-mono">
                    Active: {loadedFileStatuses.rightSurfName}
                  </div>
                </div>
                <span
                  className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0 border ${
                    loadedFileStatuses.isCustomRightSurf
                      ? 'bg-black text-emerald-400 border-emerald-500/40'
                      : 'bg-black text-[#71717A] border-[#27272A]'
                  }`}
                >
                  {loadedFileStatuses.isCustomRightSurf ? 'Uploaded' : 'Canonical'}
                </span>
              </div>

              {/* Volume */}
              <div className="p-2.5 rounded bg-[#18181B] border border-[#27272A] flex items-start justify-between">
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5 font-medium text-[#FAFAFA]">
                    <Box className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">MNI152_T1_0.7mm.nii.gz</span>
                  </div>
                  <div className="text-[11px] text-[#71717A] mt-0.5 truncate font-mono">
                    Active: {loadedFileStatuses.volumeName}
                  </div>
                </div>
                <span
                  className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0 border ${
                    loadedFileStatuses.isCustomVolume
                      ? 'bg-black text-emerald-400 border-emerald-500/40'
                      : 'bg-black text-[#71717A] border-[#27272A]'
                  }`}
                >
                  {loadedFileStatuses.isCustomVolume ? 'Uploaded' : 'Canonical'}
                </span>
              </div>

              {/* Parcellation */}
              <div className="p-2.5 rounded bg-[#18181B] border border-[#27272A] flex items-start justify-between">
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5 font-medium text-[#FAFAFA]">
                    <Layers className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span className="truncate">Glasser / Brodmann / RSN</span>
                  </div>
                  <div className="text-[11px] text-[#71717A] mt-0.5 truncate font-mono">
                    Active: {loadedFileStatuses.parcellationName}
                  </div>
                </div>
                <span
                  className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0 border ${
                    loadedFileStatuses.isCustomParc
                      ? 'bg-black text-emerald-400 border-emerald-500/40'
                      : 'bg-black text-[#71717A] border-[#27272A]'
                  }`}
                >
                  {loadedFileStatuses.isCustomParc ? 'Uploaded' : 'Canonical'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#27272A] bg-[#09090B]">
          <button
            type="button"
            onClick={() => {
              onResetDefaults();
              setSuccessMessage('Reset to canonical HCP and MNI152 reference data.');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#18181B] hover:bg-[#27272A] border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA] rounded font-medium transition-colors text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#38BDF8] hover:bg-[#38BDF8]/90 text-black font-semibold rounded transition-colors text-xs uppercase tracking-wider"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

