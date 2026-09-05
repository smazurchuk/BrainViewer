import * as nifti from 'nifti-reader-js';
import { Parcellation, ParcellationLabel } from './types';

// Helper to decode XML entities
function decodeXmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'");
}

export function parseCiftiFile(buffer: ArrayBuffer, fileName = 'parcellation.dlabel.nii'): Parcellation {
  let arrayBuffer = buffer;
  if (nifti.isCompressed(arrayBuffer)) {
    arrayBuffer = nifti.decompress(arrayBuffer);
  }

  if (!nifti.isNIFTI(arrayBuffer)) {
    throw new Error(`File ${fileName} is not a valid NIfTI/CIFTI format`);
  }

  const header = nifti.readHeader(arrayBuffer);
  if (!header) {
    throw new Error(`Could not read header for ${fileName}`);
  }

  // Find CIFTI XML in NIfTI extensions or in header buffer
  let xmlString = '';
  if (nifti.hasExtension(header)) {
    try {
      const ext = nifti.readExtensionData(header, arrayBuffer);
      if (ext) {
        const textDecoder = new TextDecoder('utf-8', { fatal: false });
        xmlString = textDecoder.decode(ext);
      }
    } catch {
      // Extension read failed, will search raw buffer
    }
  }

  if (!xmlString || !xmlString.includes('<CIFTI')) {
    // Search the first 512KB for CIFTI xml
    const bytes = new Uint8Array(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 512 * 1024)));
    const textDecoder = new TextDecoder('utf-8', { fatal: false });
    const fullText = textDecoder.decode(bytes);
    const ciftiStart = fullText.indexOf('<CIFTI');
    if (ciftiStart !== -1) {
      const ciftiEnd = fullText.indexOf('</CIFTI>', ciftiStart);
      if (ciftiEnd !== -1) {
        xmlString = fullText.slice(ciftiStart, ciftiEnd + 8);
      }
    }
  }

  // In CIFTI files (NIfTI-2 or NIfTI-1), dense data begins at header.vox_offset
  const anyHeader = header as any;
  const voxOffset = anyHeader.vox_offset || 352;
  const dataSlice = arrayBuffer.slice(voxOffset);

  let rawData: Float32Array | Int32Array;
  if (header.datatypeCode === 16) {
    rawData = new Float32Array(dataSlice);
  } else if (header.datatypeCode === 8) {
    rawData = new Int32Array(dataSlice);
  } else if (header.datatypeCode === 4) {
    rawData = new Int16Array(dataSlice) as any;
  } else if (header.datatypeCode === 2) {
    rawData = new Uint8Array(dataSlice) as any;
  } else {
    rawData = new Float32Array(dataSlice);
  }

  const labels = new Map<number, ParcellationLabel>();

  // Parse LabelTable
  if (xmlString) {
    try {
      const labelRegex = /<Label\s+([^>]+?)>([^<]*)<\/Label>/g;
      let labelMatch: RegExpExecArray | null;
      while ((labelMatch = labelRegex.exec(xmlString)) !== null) {
        const attrs = labelMatch[1];
        const rawName = labelMatch[2]?.trim() || '';
        const name = decodeXmlEntities(rawName);

        const keyMatch = attrs.match(/Key="([^"]+)"/);
        const redMatch = attrs.match(/Red="([^"]+)"/);
        const greenMatch = attrs.match(/Green="([^"]+)"/);
        const blueMatch = attrs.match(/Blue="([^"]+)"/);
        const alphaMatch = attrs.match(/Alpha="([^"]+)"/);

        if (keyMatch) {
          const key = parseInt(keyMatch[1], 10);
          const r = redMatch ? parseFloat(redMatch[1]) : 0.5;
          const g = greenMatch ? parseFloat(greenMatch[1]) : 0.5;
          const b = blueMatch ? parseFloat(blueMatch[1]) : 0.5;
          const a = alphaMatch ? parseFloat(alphaMatch[1]) : 1.0;

          const upperName = name.toUpperCase();
          const hemi =
            upperName.startsWith('L_') || upperName.startsWith('LEFT_') || upperName.includes('.L.')
              ? 'L'
              : upperName.startsWith('R_') || upperName.startsWith('RIGHT_') || upperName.includes('.R.')
              ? 'R'
              : undefined;

          labels.set(key, {
            key,
            name: name || `Label_${key}`,
            color: [r, g, b, a],
            hemi
          });
        }
      }
    } catch (e) {
      console.warn('Could not fully parse CIFTI XML label table:', e);
    }
  }

  // Parse BrainModels to map dense indices to 32k_fs_LR surface vertices
  const STANDARD_SURFACE_VERTICES = 32492;
  const vertexLabelsL = new Int32Array(STANDARD_SURFACE_VERTICES);
  const vertexLabelsR = new Int32Array(STANDARD_SURFACE_VERTICES);
  let parsedBrainModels = false;

  if (xmlString) {
    try {
      // Regex matches both self-closing <BrainModel ... /> and container <BrainModel ...>...</BrainModel>
      const bmRegex = /<BrainModel\s+([^>]+?)(?:\/>|>([\s\S]*?)<\/BrainModel>)/g;
      let bmMatch: RegExpExecArray | null;

      while ((bmMatch = bmRegex.exec(xmlString)) !== null) {
        const attrs = bmMatch[1];
        const inner = bmMatch[2] || '';

        const structure = attrs.match(/BrainStructure="([^"]+)"/)?.[1] || '';
        const offset = parseInt(attrs.match(/IndexOffset="([^"]+)"/)?.[1] || '0', 10);
        const count = parseInt(attrs.match(/IndexCount="([^"]+)"/)?.[1] || '0', 10);

        const isLeft = structure.includes('CORTEX_LEFT');
        const isRight = structure.includes('CORTEX_RIGHT');
        const targetArr = isLeft ? vertexLabelsL : isRight ? vertexLabelsR : null;

        if (targetArr && count > 0) {
          parsedBrainModels = true;
          const vertIndicesMatch = inner.match(/<VertexIndices>([\s\S]*?)<\/VertexIndices>/);

          if (vertIndicesMatch) {
            // Explicit vertex indices provided
            const indices = vertIndicesMatch[1].trim().split(/\s+/).map(Number);
            for (let k = 0; k < indices.length && k < count; k++) {
              const vIdx = indices[k];
              if (vIdx < targetArr.length && offset + k < rawData.length) {
                targetArr[vIdx] = Math.round(rawData[offset + k]);
              }
            }
          } else {
            // Contiguous 0..count-1 vertex indices
            for (let k = 0; k < count && k < targetArr.length && offset + k < rawData.length; k++) {
              targetArr[k] = Math.round(rawData[offset + k]);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error parsing CIFTI BrainModel structures:', e);
    }
  }

  // Fallback: If no BrainModels were found, do standard contiguous split
  if (!parsedBrainModels && rawData.length > 0) {
    const totalElements = rawData.length;
    if (totalElements >= 64984) {
      const half = Math.floor(totalElements / 2);
      for (let i = 0; i < Math.min(half, STANDARD_SURFACE_VERTICES); i++) {
        vertexLabelsL[i] = Math.round(rawData[i]);
      }
      for (let i = 0; i < Math.min(totalElements - half, STANDARD_SURFACE_VERTICES); i++) {
        vertexLabelsR[i] = Math.round(rawData[half + i]);
      }
    } else {
      const limit = Math.min(totalElements, STANDARD_SURFACE_VERTICES);
      for (let i = 0; i < limit; i++) {
        vertexLabelsL[i] = Math.round(rawData[i]);
        vertexLabelsR[i] = Math.round(rawData[i]);
      }
    }
  }

  // Extract clean display name
  const cleanName = fileName
    .replace('.32k_fs_LR.dlabel.nii', '')
    .replace('.dlabel.nii', '')
    .replace('.nii', '');

  return {
    id: `cifti_${fileName.replace(/[^a-zA-Z0-9]/g, '_')}`,
    name: cleanName,
    description: `CIFTI atlas with ${labels.size} parcels loaded from ${fileName}`,
    labels,
    vertexLabelsL,
    vertexLabelsR,
    sourceFileName: fileName
  };
}
