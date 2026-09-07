import * as nifti from 'nifti-reader-js';
import { VolumeData } from './types';
import { invertMatrix4 } from './matrixUtils';
import NiftiWorker from './niftiWorker?worker';

/**
 * Parse a NIfTI volume asynchronously using a Web Worker (off main thread).
 * Falls back to synchronous parsing if Worker creation fails.
 */
export function parseNiftiVolumeAsync(buffer: ArrayBuffer, fileName = 'volume.nii'): Promise<VolumeData> {
  return new Promise((resolve, reject) => {
    try {
      const worker = new NiftiWorker();
      worker.onmessage = (e: MessageEvent) => {
        worker.terminate();
        if (e.data.success) {
          resolve(e.data.result as VolumeData);
        } else {
          reject(new Error(e.data.error || 'NIfTI worker failed'));
        }
      };
      worker.onerror = (err) => {
        worker.terminate();
        // Fallback to synchronous parsing
        console.warn('[niftiParser] Worker error, falling back to main thread:', err);
        try {
          resolve(parseNiftiVolume(buffer, fileName));
        } catch (e) {
          reject(e);
        }
      };
      // Transfer the buffer to the worker (zero-copy)
      worker.postMessage({ buffer, fileName }, [buffer]);
    } catch {
      // Worker creation failed (e.g. CSP restriction) — fall back to sync
      console.warn('[niftiParser] Worker creation failed, falling back to main thread');
      try {
        resolve(parseNiftiVolume(buffer, fileName));
      } catch (e) {
        reject(e as Error);
      }
    }
  });
}

export function parseNiftiVolume(buffer: ArrayBuffer, fileName = 'volume.nii'): VolumeData {
  let arrayBuffer = buffer;
  if (nifti.isCompressed(arrayBuffer)) {
    arrayBuffer = nifti.decompress(arrayBuffer);
  }

  if (!nifti.isNIFTI(arrayBuffer)) {
    throw new Error(`File ${fileName} is not a valid NIfTI format`);
  }

  const header = nifti.readHeader(arrayBuffer);
  if (!header) {
    throw new Error(`Failed to read NIfTI header from ${fileName}`);
  }

  const rawImage = nifti.readImage(header, arrayBuffer);
  const dims: [number, number, number] = [
    header.dims[1] || 1,
    header.dims[2] || 1,
    header.dims[3] || 1
  ];
  const pixDims: [number, number, number] = [
    Math.abs(header.pixDims[1] || 1),
    Math.abs(header.pixDims[2] || 1),
    Math.abs(header.pixDims[3] || 1)
  ];

  // Extract Affine Matrix (sform or qform or default)
  const anyHeader = header as any;
  let affine: number[][];
  if (anyHeader.affine && Array.isArray(anyHeader.affine) && anyHeader.affine.length === 4) {
    affine = anyHeader.affine as number[][];
  } else if (anyHeader.srow_x && anyHeader.srow_y && anyHeader.srow_z) {
    affine = [
      [anyHeader.srow_x[0], anyHeader.srow_x[1], anyHeader.srow_x[2], anyHeader.srow_x[3]],
      [anyHeader.srow_y[0], anyHeader.srow_y[1], anyHeader.srow_y[2], anyHeader.srow_y[3]],
      [anyHeader.srow_z[0], anyHeader.srow_z[1], anyHeader.srow_z[2], anyHeader.srow_z[3]],
      [0, 0, 0, 1]
    ];
  } else {
    // Default fallback based on pixDims centered around zero
    const [dx, dy, dz] = pixDims;
    const [nx, ny, nz] = dims;
    affine = [
      [-dx, 0, 0, (nx * dx) / 2],
      [0, dy, 0, -(ny * dy) / 2],
      [0, 0, dz, -(nz * dz) / 2],
      [0, 0, 0, 1]
    ];
  }

  const invAffine = invertMatrix4(affine);

  // Convert raw image data to typed array efficiently
  const totalVoxels = dims[0] * dims[1] * dims[2];
  let data: Float32Array | Uint8Array | Int16Array;

  switch (header.datatypeCode) {
    case 2: // DT_UINT8 (e.g. MNI152 T1w) - keep as Uint8Array to save 63MB of memory
      data = new Uint8Array(rawImage);
      break;
    case 4: // DT_INT16
      data = new Int16Array(rawImage);
      break;
    case 8: // DT_INT32
      data = new Float32Array(new Int32Array(rawImage));
      break;
    case 16: // DT_FLOAT32
      data = new Float32Array(rawImage);
      break;
    case 64: // DT_FLOAT64
      {
        const f64 = new Float64Array(rawImage);
        data = new Float32Array(f64.length);
        for (let i = 0; i < f64.length; i++) data[i] = f64[i];
      }
      break;
    case 512: // DT_UINT16
      data = new Float32Array(new Uint16Array(rawImage));
      break;
    default:
      // Fallback
      data = new Float32Array(rawImage);
      break;
  }

  // Calculate intensity range
  let minVal = Infinity;
  let maxVal = -Infinity;
  const stride = Math.max(1, Math.floor(totalVoxels / 50000)); // fast sample
  for (let i = 0; i < totalVoxels; i += stride) {
    const v = data[i];
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }

  if (minVal === Infinity || maxVal === -Infinity || minVal === maxVal) {
    minVal = 0;
    maxVal = 100;
  }

  return {
    id: `vol_${Date.now()}`,
    name: fileName,
    dims,
    pixDims,
    data,
    minVal,
    maxVal,
    affine,
    invAffine,
    isDefaultTemplate: false
  };
}
