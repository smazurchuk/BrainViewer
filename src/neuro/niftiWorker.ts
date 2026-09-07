// Web Worker for off-main-thread NIfTI decompression and parsing.
// Receives an ArrayBuffer, decompresses + parses, returns VolumeData fields.

import * as nifti from 'nifti-reader-js';

// Inline invertMatrix4 to avoid importing from matrixUtils (workers have isolated module scope)
function invertMatrix4(m: number[][]): number[][] {
  const a = m.flat();
  const inv: number[] = new Array(16);

  inv[0] = a[5]*a[10]*a[15] - a[5]*a[11]*a[14] - a[9]*a[6]*a[15] + a[9]*a[7]*a[14] + a[13]*a[6]*a[11] - a[13]*a[7]*a[10];
  inv[4] = -a[4]*a[10]*a[15] + a[4]*a[11]*a[14] + a[8]*a[6]*a[15] - a[8]*a[7]*a[14] - a[12]*a[6]*a[11] + a[12]*a[7]*a[10];
  inv[8] = a[4]*a[9]*a[15] - a[4]*a[11]*a[13] - a[8]*a[5]*a[15] + a[8]*a[7]*a[13] + a[12]*a[5]*a[11] - a[12]*a[7]*a[9];
  inv[12] = -a[4]*a[9]*a[14] + a[4]*a[10]*a[13] + a[8]*a[5]*a[14] - a[8]*a[6]*a[13] - a[12]*a[5]*a[10] + a[12]*a[6]*a[9];

  inv[1] = -a[1]*a[10]*a[15] + a[1]*a[11]*a[14] + a[9]*a[2]*a[15] - a[9]*a[3]*a[14] - a[13]*a[2]*a[11] + a[13]*a[3]*a[10];
  inv[5] = a[0]*a[10]*a[15] - a[0]*a[11]*a[14] - a[8]*a[2]*a[15] + a[8]*a[3]*a[14] + a[12]*a[2]*a[11] - a[12]*a[3]*a[10];
  inv[9] = -a[0]*a[9]*a[15] + a[0]*a[11]*a[13] + a[8]*a[1]*a[15] - a[8]*a[3]*a[13] - a[12]*a[1]*a[11] + a[12]*a[3]*a[9];
  inv[13] = a[0]*a[9]*a[14] - a[0]*a[10]*a[13] - a[8]*a[1]*a[14] + a[8]*a[2]*a[13] + a[12]*a[1]*a[10] - a[12]*a[2]*a[9];

  inv[2] = a[1]*a[6]*a[15] - a[1]*a[7]*a[14] - a[5]*a[2]*a[15] + a[5]*a[3]*a[14] + a[13]*a[2]*a[7] - a[13]*a[3]*a[6];
  inv[6] = -a[0]*a[6]*a[15] + a[0]*a[7]*a[14] + a[4]*a[2]*a[15] - a[4]*a[3]*a[14] - a[12]*a[2]*a[7] + a[12]*a[3]*a[6];
  inv[10] = a[0]*a[5]*a[15] - a[0]*a[7]*a[13] - a[4]*a[1]*a[15] + a[4]*a[3]*a[13] + a[12]*a[1]*a[7] - a[12]*a[3]*a[5];
  inv[14] = -a[0]*a[5]*a[14] + a[0]*a[6]*a[13] + a[4]*a[1]*a[14] - a[4]*a[2]*a[13] - a[12]*a[1]*a[6] + a[12]*a[2]*a[5];

  inv[3] = -a[1]*a[6]*a[11] + a[1]*a[7]*a[10] + a[5]*a[2]*a[11] - a[5]*a[3]*a[10] - a[9]*a[2]*a[7] + a[9]*a[3]*a[6];
  inv[7] = a[0]*a[6]*a[11] - a[0]*a[7]*a[10] - a[4]*a[2]*a[11] + a[4]*a[3]*a[10] + a[8]*a[2]*a[7] - a[8]*a[3]*a[6];
  inv[11] = -a[0]*a[5]*a[11] + a[0]*a[7]*a[9] + a[4]*a[1]*a[11] - a[4]*a[3]*a[9] - a[8]*a[1]*a[7] + a[8]*a[3]*a[5];
  inv[15] = a[0]*a[5]*a[10] - a[0]*a[6]*a[9] - a[4]*a[1]*a[10] + a[4]*a[2]*a[9] + a[8]*a[1]*a[6] - a[8]*a[2]*a[5];

  let det = a[0]*inv[0] + a[1]*inv[4] + a[2]*inv[8] + a[3]*inv[12];
  if (Math.abs(det) < 1e-12) {
    return [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  }
  det = 1.0 / det;
  return [
    [inv[0]*det, inv[1]*det, inv[2]*det, inv[3]*det],
    [inv[4]*det, inv[5]*det, inv[6]*det, inv[7]*det],
    [inv[8]*det, inv[9]*det, inv[10]*det, inv[11]*det],
    [inv[12]*det, inv[13]*det, inv[14]*det, inv[15]*det],
  ];
}

self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; fileName: string }>) => {
  try {
    const { buffer, fileName } = e.data;

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

    // Extract Affine Matrix
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

    // Convert raw image data to typed array
    const totalVoxels = dims[0] * dims[1] * dims[2];
    let data: Float32Array | Uint8Array | Int16Array;

    switch (header.datatypeCode) {
      case 2:
        data = new Uint8Array(rawImage);
        break;
      case 4:
        data = new Int16Array(rawImage);
        break;
      case 8:
        data = new Float32Array(new Int32Array(rawImage));
        break;
      case 16:
        data = new Float32Array(rawImage);
        break;
      case 64: {
        const f64 = new Float64Array(rawImage);
        data = new Float32Array(f64.length);
        for (let i = 0; i < f64.length; i++) data[i] = f64[i];
        break;
      }
      case 512:
        data = new Float32Array(new Uint16Array(rawImage));
        break;
      default:
        data = new Float32Array(rawImage);
        break;
    }

    // Calculate intensity range
    let minVal = Infinity;
    let maxVal = -Infinity;
    const stride = Math.max(1, Math.floor(totalVoxels / 50000));
    for (let i = 0; i < totalVoxels; i += stride) {
      const v = data[i];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    if (minVal === Infinity || maxVal === -Infinity || minVal === maxVal) {
      minVal = 0;
      maxVal = 100;
    }

    // Post result back with Transferable buffer for zero-copy
    const result = {
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

    self.postMessage({ success: true, result }, [data.buffer] as any);
  } catch (err: any) {
    self.postMessage({ success: false, error: err.message || String(err) });
  }
};
