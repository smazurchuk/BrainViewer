import { SurfaceMesh, VolumeData, Parcellation } from './types';
import { parseGiftiSurface } from './giftiParser';
import { parseNiftiVolume } from './niftiParser';
import { parseCiftiFile } from './ciftiParser';

export interface UploadedDatasetProgress {
  step: string;
  percent: number;
}

// Global subscribers for dataset loading progress
const progressSubscribers = new Set<(progress: UploadedDatasetProgress) => void>();

function notifyProgress(step: string, percent: number) {
  const payload: UploadedDatasetProgress = { step, percent };
  for (const sub of progressSubscribers) {
    try {
      sub(payload);
    } catch {
      // subscriber error ignored
    }
  }
}

// Yield to browser event loop so React and the DOM can repaint progress bars smoothly
function yieldToMainThread(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Robust buffer validator to differentiate real neuroimaging assets from HTML SPA 404 fallbacks
function isHtmlFallback(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength === 0) return true;

  const sampleLen = Math.min(buffer.byteLength, 1024);
  const bytes = new Uint8Array(buffer, 0, sampleLen);

  // Gzip binary stream: magic number 0x1f, 0x8b (e.g. MNI152_T1_0.7mm.nii.gz)
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return false;
  }

  // NIfTI-1 binary header sizeof_hdr (348 bytes: 0x5c 0x01 in little-endian or 0x01 0x5c in big-endian)
  if (
    (bytes[0] === 0x5c && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) ||
    (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x5c)
  ) {
    return false;
  }

  // Text sample for XML/HTML inspection
  const sample = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim().toLowerCase();

  // GIFTI XML surface data: starts with <?xml or <gifti, contains <dataarray
  if (sample.startsWith('<?xml') || sample.startsWith('<gifti') || sample.includes('<gifti')) {
    return false;
  }

  // Check for HTML SPA fallback indicators (like index.html served on 404)
  if (
    sample.startsWith('<!doctype') ||
    sample.startsWith('<html') ||
    sample.includes('<html') ||
    sample.includes('<div id="root"') ||
    sample.includes('<title>')
  ) {
    return true;
  }

  return false;
}

// Robust asset buffer fetcher with direct arrayBuffer streaming and fallback URL candidates
export async function fetchAssetBuffer(filename: string): Promise<ArrayBuffer> {
  const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  const prefix = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  // Candidate URLs targeting the public data directory where datasets reside
  const candidateUrls: string[] = [
    `/data/${filename}`,
    `./data/${filename}`,
    `${prefix}data/${filename}`.replace(/\/{2,}/g, '/'),
    `data/${filename}`
  ];

  if (typeof window !== 'undefined' && window.location?.origin) {
    try {
      candidateUrls.unshift(new URL(`data/${filename}`, window.location.origin + '/').href);
    } catch {}
  }

  const uniqueUrls = Array.from(new Set(candidateUrls));
  let lastError: Error | null = null;

  for (const url of uniqueUrls) {
    try {
      // 60-second timeout for large binary files (e.g. 12MB MNI152 volume)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
        continue;
      }

      // Directly consume arrayBuffer without clone() to prevent memory duplication and stream locking
      const buffer = await res.arrayBuffer();

      // Check if response is an HTML SPA fallback error page (e.g. index.html)
      if (isHtmlFallback(buffer)) {
        lastError = new Error(`Received HTML document for ${filename} at ${url} (SPA fallback)`);
        continue;
      }

      return buffer;
    } catch (err: any) {
      lastError = err;
    }
  }

  throw new Error(
    `Failed to fetch ${filename}. Last error: ${lastError?.message || 'HTTP 404'}`
  );
}

// Fetch UTF-8 text asset (e.g. GIFTI XML)
export async function fetchAssetText(filename: string): Promise<string> {
  const buffer = await fetchAssetBuffer(filename);
  return new TextDecoder('utf-8').decode(buffer);
}

// Robust asset URL resolution helper
export function getAssetUrl(relPath: string): string {
  const cleanRel = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  if (typeof window !== 'undefined' && window.location) {
    try {
      return new URL(cleanRel, window.location.origin + '/').href;
    } catch {
      return '/' + cleanRel;
    }
  }
  return '/' + cleanRel;
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
  const filename = UPLOADED_FILES_MANIFEST.leftSurf.filename;
  const text = await fetchAssetText(filename);
  await yieldToMainThread(15);
  return parseGiftiSurface(text, filename);
}

export async function fetchAndParseRightSurface(): Promise<SurfaceMesh> {
  const filename = UPLOADED_FILES_MANIFEST.rightSurf.filename;
  const text = await fetchAssetText(filename);
  await yieldToMainThread(15);
  return parseGiftiSurface(text, filename);
}

export async function fetchAndParseMniVolume(): Promise<VolumeData> {
  console.log('[datasetLoader] fetchAndParseMniVolume: fetching .nii.gz');
  const filename = UPLOADED_FILES_MANIFEST.volume.filename;
  const buffer = await fetchAssetBuffer(filename);
  console.log('[datasetLoader] fetched gz buffer byteLength:', buffer.byteLength);
  await yieldToMainThread(25);
  const vol = parseNiftiVolume(buffer, filename);
  console.log('[datasetLoader] parseNiftiVolume finished, dims:', vol.dims);
  return vol;
}

export async function fetchAndParseGlasserParc(): Promise<Parcellation> {
  const filename = UPLOADED_FILES_MANIFEST.glasserParc.filename;
  const buffer = await fetchAssetBuffer(filename);
  await yieldToMainThread(15);
  const parc = parseCiftiFile(buffer, filename);
  return {
    ...parc,
    id: 'glasser_hcp_mmp',
    name: 'Glasser HCP-MMP1.0 (Real CIFTI)'
  };
}

export async function fetchAndParseBrodmannParc(): Promise<Parcellation> {
  const filename = UPLOADED_FILES_MANIFEST.brodmannParc.filename;
  const buffer = await fetchAssetBuffer(filename);
  await yieldToMainThread(15);
  const parc = parseCiftiFile(buffer, filename);
  return {
    ...parc,
    id: 'brodmann_atlas',
    name: 'Brodmann BA09 (Real CIFTI)'
  };
}

export async function fetchAndParseRsnParc(): Promise<Parcellation> {
  const filename = UPLOADED_FILES_MANIFEST.rsnParc.filename;
  const buffer = await fetchAssetBuffer(filename);
  await yieldToMainThread(15);
  const parc = parseCiftiFile(buffer, filename);
  return {
    ...parc,
    id: 'yeo_rsn_networks',
    name: 'RSN Networks (Real CIFTI)'
  };
}

export interface LoadedHcpBundle {
  leftSurf: SurfaceMesh;
  rightSurf: SurfaceMesh;
  volume: VolumeData;
  glasserParc: Parcellation;
  brodmannParc: Parcellation;
  rsnParc: Parcellation;
  parcellations: Record<string, Parcellation>;
  isFallback?: boolean;
}

// Module-level singleton cache to prevent duplicate memory allocation and race conditions
let cachedBundle: LoadedHcpBundle | null = null;
let activeLoadPromise: Promise<LoadedHcpBundle> | null = null;

export function clearCachedBundle(): void {
  cachedBundle = null;
  activeLoadPromise = null;
}

export async function loadAllUploadedHcpDatasets(
  onProgress?: (progress: UploadedDatasetProgress) => void
): Promise<LoadedHcpBundle> {
  // If already loaded and cached (and NOT a fallback), immediately return the cached bundle
  if (cachedBundle && !cachedBundle.isFallback) {
    onProgress?.({ step: 'Dataset already loaded from memory cache', percent: 100 });
    return cachedBundle;
  }

  // Register progress listener
  if (onProgress) {
    progressSubscribers.add(onProgress);
  }

  // If a load is already in progress, await that exact promise
  if (activeLoadPromise) {
    onProgress?.({ step: 'Loading in progress, awaiting pipeline...', percent: 40 });
    try {
      const result = await activeLoadPromise;
      return result;
    } finally {
      if (onProgress) progressSubscribers.delete(onProgress);
    }
  }

  activeLoadPromise = (async () => {
    try {
      // Step 1: Left Pial Surface (1.8MB)
      notifyProgress('Loading HCP Left Pial Surface (1.8MB)...', 10);
      await yieldToMainThread(20);
      const leftSurf = await fetchAndParseLeftSurface();

      // Step 2: Right Pial Surface (1.7MB)
      notifyProgress('Loading HCP Right Pial Surface (1.7MB)...', 25);
      await yieldToMainThread(20);
      const rightSurf = await fetchAndParseRightSurface();

      // Step 3: Glasser HCP-MMP1.0 CIFTI (621KB)
      notifyProgress('Loading Glasser HCP-MMP1.0 CIFTI Parcellation...', 40);
      await yieldToMainThread(20);
      const glasser = await fetchAndParseGlasserParc();

      // Step 4: Brodmann BA09 CIFTI (644KB)
      notifyProgress('Loading Brodmann BA09 CIFTI Parcellation...', 55);
      await yieldToMainThread(20);
      const brodmann = await fetchAndParseBrodmannParc();

      // Step 5: RSN Networks CIFTI (1.07MB)
      notifyProgress('Loading RSN Resting-State Networks CIFTI...', 70);
      await yieldToMainThread(20);
      const rsn = await fetchAndParseRsnParc();

      // Step 6: MNI152 0.7mm T1w Volume (11.9MB)
      notifyProgress('Loading MNI152 0.7mm T1w Volume (11.9MB)...', 85);
      await yieldToMainThread(30);
      const volume = await fetchAndParseMniVolume();

      notifyProgress('All 6 HCP Reference Datasets Synchronized!', 100);
      await yieldToMainThread(25);

      cachedBundle = {
        leftSurf,
        rightSurf,
        volume,
        glasserParc: glasser,
        brodmannParc: brodmann,
        rsnParc: rsn,
        parcellations: {
          [glasser.id]: glasser,
          [brodmann.id]: brodmann,
          [rsn.id]: rsn
        },
        isFallback: false
      };

      return cachedBundle;
    } catch (err: any) {
      console.error('[datasetLoader] Failed to load HCP dataset files:', err);
      // Do NOT save fallback into cachedBundle so retry works properly
      throw err;
    } finally {
      activeLoadPromise = null;
    }
  })();

  try {
    const result = await activeLoadPromise;
    return result;
  } finally {
    if (onProgress) {
      progressSubscribers.delete(onProgress);
    }
  }
}
