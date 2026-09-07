import { SurfaceMesh, VolumeData, Parcellation } from './types';
import { parseGiftiSurface } from './giftiParser';
import { parseNiftiVolume, parseNiftiVolumeAsync } from './niftiParser';
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
    path: getAssetUrl('data/Yeo7_RSN.32k_fs_LR.dlabel.nii'),
    filename: 'Yeo7_RSN.32k_fs_LR.dlabel.nii',
    title: 'Yeo 2011 7 Resting-State Networks',
    size: '260 KB'
  }
};

export async function fetchAndParseLeftSurface(): Promise<SurfaceMesh> {
  const filename = UPLOADED_FILES_MANIFEST.leftSurf.filename;
  const text = await fetchAssetText(filename);
  return parseGiftiSurface(text, filename);
}

export async function fetchAndParseRightSurface(): Promise<SurfaceMesh> {
  const filename = UPLOADED_FILES_MANIFEST.rightSurf.filename;
  const text = await fetchAssetText(filename);
  return parseGiftiSurface(text, filename);
}

export async function fetchAndParseMniVolume(): Promise<VolumeData> {
  const filename = UPLOADED_FILES_MANIFEST.volume.filename;
  const buffer = await fetchAssetBuffer(filename);
  // Use Web Worker for off-main-thread decompression of the 12MB gzipped volume
  const vol = await parseNiftiVolumeAsync(buffer, filename);
  return vol;
}

export async function fetchAndParseGlasserParc(): Promise<Parcellation> {
  const filename = UPLOADED_FILES_MANIFEST.glasserParc.filename;
  const buffer = await fetchAssetBuffer(filename);
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
  const parc = parseCiftiFile(buffer, filename);
  return {
    ...parc,
    id: 'yeo_rsn_networks',
    name: 'Yeo 2011 7 Networks'
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
      // Phase 1: Fetch ALL 6 files in parallel (I/O-bound — big win over sequential)
      notifyProgress('Downloading 6 HCP datasets in parallel...', 10);
      await yieldToMainThread(5);

      const [
        leftSurfText,
        rightSurfText,
        volumeBuffer,
        glasserBuffer,
        brodmannBuffer,
        rsnBuffer
      ] = await Promise.all([
        fetchAssetText(UPLOADED_FILES_MANIFEST.leftSurf.filename),
        fetchAssetText(UPLOADED_FILES_MANIFEST.rightSurf.filename),
        fetchAssetBuffer(UPLOADED_FILES_MANIFEST.volume.filename),
        fetchAssetBuffer(UPLOADED_FILES_MANIFEST.glasserParc.filename),
        fetchAssetBuffer(UPLOADED_FILES_MANIFEST.brodmannParc.filename),
        fetchAssetBuffer(UPLOADED_FILES_MANIFEST.rsnParc.filename)
      ]);

      // Phase 2: Parse all datasets. NIfTI goes to a Web Worker (heaviest job).
      // Start the volume worker immediately so it runs concurrently with main-thread parsing.
      notifyProgress('Parsing surfaces and parcellations...', 50);
      await yieldToMainThread(5);

      const volumePromise = parseNiftiVolumeAsync(volumeBuffer, UPLOADED_FILES_MANIFEST.volume.filename);

      // Parse surfaces and parcellations on main thread (these are fast)
      const leftSurf = parseGiftiSurface(leftSurfText, UPLOADED_FILES_MANIFEST.leftSurf.filename);
      const rightSurf = parseGiftiSurface(rightSurfText, UPLOADED_FILES_MANIFEST.rightSurf.filename);

      notifyProgress('Parsing CIFTI parcellations...', 70);

      const glasserRaw = parseCiftiFile(glasserBuffer, UPLOADED_FILES_MANIFEST.glasserParc.filename);
      const glasser = { ...glasserRaw, id: 'glasser_hcp_mmp', name: 'Glasser HCP-MMP1.0 (Real CIFTI)' };

      const brodmannRaw = parseCiftiFile(brodmannBuffer, UPLOADED_FILES_MANIFEST.brodmannParc.filename);
      const brodmann = { ...brodmannRaw, id: 'brodmann_atlas', name: 'Brodmann BA09 (Real CIFTI)' };

      const rsnRaw = parseCiftiFile(rsnBuffer, UPLOADED_FILES_MANIFEST.rsnParc.filename);
      const rsn = { ...rsnRaw, id: 'yeo_rsn_networks', name: 'Yeo 2011 7 Networks' };

      // Wait for the volume worker to finish
      notifyProgress('Decompressing MNI152 volume...', 85);
      const volume = await volumePromise;

      notifyProgress('All 6 HCP Reference Datasets Synchronized!', 100);

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
