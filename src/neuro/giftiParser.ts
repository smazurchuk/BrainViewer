import { inflate } from 'pako';
import { SurfaceMesh } from './types';

// Lookup table for fast base64 decoding directly into Uint8Array without intermediate strings or atob DOMException
const B64_LOOKUP = new Uint8Array(256);
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

// Convert base64 string to Uint8Array directly
function base64ToUint8Array(base64: string): Uint8Array {
  // Remove whitespace, linebreaks, tabs
  const clean = base64.replace(/[\s\r\n\t]/g, '');
  const len = clean.length;
  if (len === 0) return new Uint8Array(0);

  let validLen = len;
  if (clean[len - 1] === '=') validLen--;
  if (len > 1 && clean[len - 2] === '=') validLen--;

  const outLen = Math.floor((validLen * 3) / 4);
  const bytes = new Uint8Array(outLen);
  let p = 0;

  for (let i = 0; i < len; i += 4) {
    const b0 = B64_LOOKUP[clean.charCodeAt(i)];
    const b1 = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const b2 = B64_LOOKUP[clean.charCodeAt(i + 2)];
    const b3 = B64_LOOKUP[clean.charCodeAt(i + 3)];

    bytes[p++] = (b0 << 2) | (b1 >> 4);
    if (p < outLen) bytes[p++] = ((b1 & 15) << 4) | (b2 >> 2);
    if (p < outLen) bytes[p++] = ((b2 & 3) << 6) | b3;
  }

  return bytes;
}

export function parseGiftiSurface(xmlText: string, fileName = 'surface.surf.gii'): SurfaceMesh {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`Invalid GIFTI XML in ${fileName}: ${parseError.textContent}`);
  }

  const dataArrays = xmlDoc.querySelectorAll('DataArray');
  if (dataArrays.length === 0) {
    throw new Error(`No DataArray elements found in GIFTI file ${fileName}`);
  }

  let vertices: Float32Array | null = null;
  let faces: Uint32Array | null = null;

  for (let idx = 0; idx < dataArrays.length; idx++) {
    const da = dataArrays[idx];
    const intent = da.getAttribute('Intent') || '';
    const encoding = da.getAttribute('Encoding') || 'GZipBase64Binary';
    const dataType = da.getAttribute('DataType') || '';
    const dim0 = parseInt(da.getAttribute('Dim0') || '0', 10);
    const dim1 = parseInt(da.getAttribute('Dim1') || '3', 10);

    const dataElem = da.querySelector('Data');
    if (!dataElem || !dataElem.textContent) continue;

    const rawDataText = dataElem.textContent.trim();
    let arrayBuffer: ArrayBuffer;

    if (encoding === 'GZipBase64Binary') {
      const compressedBytes = base64ToUint8Array(rawDataText);
      const decompressed = inflate(compressedBytes);
      arrayBuffer = decompressed.buffer.slice(decompressed.byteOffset, decompressed.byteOffset + decompressed.byteLength);
    } else if (encoding === 'Base64Binary') {
      const rawBytes = base64ToUint8Array(rawDataText);
      arrayBuffer = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);
    } else if (encoding === 'ASCII') {
      const numbers = rawDataText.split(/\s+/).map(Number);
      if (intent === 'NIFTI_INTENT_POINTSET') {
        vertices = new Float32Array(numbers);
      } else if (intent === 'NIFTI_INTENT_TRIANGLE') {
        faces = new Uint32Array(numbers);
      }
      continue;
    } else {
      throw new Error(`Unsupported GIFTI encoding: ${encoding}`);
    }

    if (intent === 'NIFTI_INTENT_POINTSET') {
      vertices = new Float32Array(arrayBuffer);
    } else if (intent === 'NIFTI_INTENT_TRIANGLE') {
      if (dataType === 'NIFTI_TYPE_INT32') {
        const int32 = new Int32Array(arrayBuffer);
        faces = new Uint32Array(int32.length);
        for (let i = 0; i < int32.length; i++) faces[i] = int32[i];
      } else if (dataType === 'NIFTI_TYPE_UINT32') {
        faces = new Uint32Array(arrayBuffer);
      } else {
        faces = new Uint32Array(new Int32Array(arrayBuffer));
      }
    }
  }

  if (!vertices || !faces) {
    throw new Error(`GIFTI file ${fileName} missing pointset (vertices) or triangle (faces) arrays`);
  }

  // Determine hemisphere from filename or coordinates
  let hemi: 'left' | 'right' = 'left';
  const lowerName = fileName.toLowerCase();
  if (lowerName.includes('.l.') || lowerName.includes('lh.') || lowerName.includes('_l_') || lowerName.includes('left')) {
    hemi = 'left';
  } else if (lowerName.includes('.r.') || lowerName.includes('rh.') || lowerName.includes('_r_') || lowerName.includes('right')) {
    hemi = 'right';
  } else {
    // Check mean X coordinate
    let sumX = 0;
    const numVerts = vertices.length / 3;
    for (let i = 0; i < numVerts; i++) {
      sumX += vertices[i * 3];
    }
    hemi = (sumX / numVerts) >= 0 ? 'right' : 'left';
  }

  return {
    id: `surf_${Date.now()}_${hemi}`,
    name: fileName,
    hemi,
    vertices,
    faces,
    sourceFileName: fileName,
  };
}
