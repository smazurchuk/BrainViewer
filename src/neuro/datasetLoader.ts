import { SurfaceMesh, VolumeData, Parcellation } from './types';
import { parseGiftiSurface } from './giftiParser';
import { parseNiftiVolume } from './niftiParser';
import { parseCiftiFile } from './ciftiParser';

export interface UploadedDatasetProgress {
  step: string;
  percent: number;
}

// GitHub Pages and Vite base path resolution helper
export function getAssetUrl(relPath: string): string {
  const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base = metaEnv?.BASE_URL || './';
  const cleanBase = base.endsWith('/') ? base : base + '/';
  const cleanRel = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  return cleanBase + cleanRel;
}

export const UPLOADED_FILES_MANIFEST = {
  leftSurf: {
    path: getAssetUrl('data/S1200.L.pial_MSMAll.32k_fs_LR.surf.gii'),
    filename: 'S1200.L.pial_MSMAll.32k_fs_LR.surf.gii',
    title: 'HCP S1200 Left Pial Surface',
    size: '1.8 MB'
  },
  rightSurf: {
    path: getAssetUrl('data/S1200.R.pial_MSMAll.32k_fs_LR.surf.gii'),
    filename: 'S1200.R.pial_MSMAll.32k_fs_LR.surf.gii',
    title: 'HCP S1200 Right Pial Surface',
    size: '1.7 MB'
  },
  volume: {
    path: getAssetUrl('data/MNI152_T1_0.7mm.nii.gz'),
    filename: 'MNI152_T1_0.7mm.nii.gz',
    title: 'MNI152 0.7mm T1w MRI Volume',
    size: '11.9 MB'
  },
  glasserParc: {
    path: getAssetUrl('data/Q1-Q6_RelatedValidation210.CorticalAreas_dil_Final_Final_Areas_Group_Colors.32k_fs_LR.dlabel.nii'),
    filename: 'Q1-Q6_RelatedValidation210.CorticalAreas_dil_Final_Final_Areas_Group_Colors.32k_fs_LR.dlabel.nii',
    title: 'Glasser HCP-MMP 1.0 (360 Areas)',
    size: '621 KB'
  },
  brodmannParc: {
    path: getAssetUrl('data/Human.Brodmann09.32k_fs_LR.dlabel.nii'),
    filename: 'Human.Brodmann09.32k_fs_LR.dlabel.nii',
    title: 'Brodmann BA09 Atlas',
    size: '644 KB'
  },
  rsnParc: {
    path: getAssetUrl('data/RSN-networks.32k_fs_LR.dlabel.nii'),
    filename: 'RSN-networks.32k_fs_LR.dlabel.nii',
    title: 'RSN Resting State Networks (Yeo 7/17)',
    size: '1.07 MB'
  }
};

export async function fetchAndParseLeftSurface(): Promise<SurfaceMesh> {
  const res = await fetch(UPLOADED_FILES_MANIFEST.leftSurf.path);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch ${UPLOADED_FILES_MANIFEST.leftSurf.filename}`);
  const text = await res.text();
  return parseGiftiSurface(text, UPLOADED_FILES_MANIFEST.leftSurf.filename);
}

export async function fetchAndParseRightSurface(): Promise<SurfaceMesh> {
  const res = await fetch(UPLOADED_FILES_MANIFEST.rightSurf.path);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch ${UPLOADED_FILES_MANIFEST.rightSurf.filename}`);
  const text = await res.text();
  return parseGiftiSurface(text, UPLOADED_FILES_MANIFEST.rightSurf.filename);
}

export async function fetchAndParseMniVolume(): Promise<VolumeData> {
  const res = await fetch(UPLOADED_FILES_MANIFEST.volume.path);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch ${UPLOADED_FILES_MANIFEST.volume.filename}`);
  const buffer = await res.arrayBuffer();
  return parseNiftiVolume(buffer, UPLOADED_FILES_MANIFEST.volume.filename);
}

export async function fetchAndParseGlasserParc(): Promise<Parcellation> {
  const res = await fetch(UPLOADED_FILES_MANIFEST.glasserParc.path);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch ${UPLOADED_FILES_MANIFEST.glasserParc.filename}`);
  const buffer = await res.arrayBuffer();
  const parc = parseCiftiFile(buffer, UPLOADED_FILES_MANIFEST.glasserParc.filename);
  return {
    ...parc,
    id: 'glasser_hcp_mmp',
    name: 'Glasser HCP-MMP1.0 (Real CIFTI)'
  };
}

export async function fetchAndParseBrodmannParc(): Promise<Parcellation> {
  const res = await fetch(UPLOADED_FILES_MANIFEST.brodmannParc.path);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch ${UPLOADED_FILES_MANIFEST.brodmannParc.filename}`);
  const buffer = await res.arrayBuffer();
  const parc = parseCiftiFile(buffer, UPLOADED_FILES_MANIFEST.brodmannParc.filename);
  return {
    ...parc,
    id: 'brodmann_atlas',
    name: 'Brodmann BA09 (Real CIFTI)'
  };
}

export async function fetchAndParseRsnParc(): Promise<Parcellation> {
  const res = await fetch(UPLOADED_FILES_MANIFEST.rsnParc.path);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch ${UPLOADED_FILES_MANIFEST.rsnParc.filename}`);
  const buffer = await res.arrayBuffer();
  const parc = parseCiftiFile(buffer, UPLOADED_FILES_MANIFEST.rsnParc.filename);
  return {
    ...parc,
    id: 'yeo_rsn_networks',
    name: 'RSN Networks (Real CIFTI)'
  };
}

export async function loadAllUploadedHcpDatasets(
  onProgress?: (progress: UploadedDatasetProgress) => void
): Promise<{
  leftSurf: SurfaceMesh;
  rightSurf: SurfaceMesh;
  volume: VolumeData;
  parcellations: Record<string, Parcellation>;
}> {
  onProgress?.({ step: 'Fetching Left Pial Surface (S1200.L.pial_MSMAll)...', percent: 10 });
  const leftSurf = await fetchAndParseLeftSurface();

  onProgress?.({ step: 'Fetching Right Pial Surface (S1200.R.pial_MSMAll)...', percent: 25 });
  const rightSurf = await fetchAndParseRightSurface();

  onProgress?.({ step: 'Fetching Glasser MMP 1.0 CIFTI parcellation...', percent: 45 });
  const glasser = await fetchAndParseGlasserParc();

  onProgress?.({ step: 'Fetching Brodmann Atlas CIFTI parcellation...', percent: 60 });
  const brodmann = await fetchAndParseBrodmannParc();

  onProgress?.({ step: 'Fetching RSN Networks CIFTI parcellation...', percent: 75 });
  const rsn = await fetchAndParseRsnParc();

  onProgress?.({ step: 'Fetching & Decompressing MNI152 0.7mm T1w Volume (12MB)...', percent: 85 });
  const volume = await fetchAndParseMniVolume();

  onProgress?.({ step: 'All HCP datasets loaded and synchronized!', percent: 100 });

  return {
    leftSurf,
    rightSurf,
    volume,
    parcellations: {
      glasser_hcp_mmp: glasser,
      brodmann_atlas: brodmann,
      yeo_rsn_networks: rsn
    }
  };
}
