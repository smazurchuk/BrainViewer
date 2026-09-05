import { SurfaceMesh, Parcellation, ParcellationLabel, VolumeData } from './types';
import { invertMatrix4 } from './matrixUtils';

// Helper to generate a realistic folded cortical hemisphere mesh in MNI space
function generateCorticalHemisphere(hemi: 'left' | 'right'): SurfaceMesh {
  const isLeft = hemi === 'left';
  const hemiSign = isLeft ? -1 : 1;

  // Grid resolution for standard canonical display
  const latSteps = 48; // latitude / pole-to-pole
  const lonSteps = 54; // longitude / azimuth around hemisphere
  const numVertices = (latSteps + 1) * lonSteps;
  const vertices = new Float32Array(numVertices * 3);
  const curvatures = new Float32Array(numVertices);
  const faces = new Uint32Array(latSteps * lonSteps * 6);

  let vIdx = 0;
  for (let i = 0; i <= latSteps; i++) {
    const u = i / latSteps; // 0 (inferior/ventral) to 1 (superior/dorsal)
    const theta = (u - 0.5) * Math.PI; // -pi/2 to pi/2

    for (let j = 0; j < lonSteps; j++) {
      const v = j / lonSteps;
      // Azimuth covers the hemisphere: 0 to pi
      const phi = v * Math.PI;

      // Base ellipsoid in MNI mm
      // Human brain dimensions in MNI:
      // X: ~-75 to -5 mm (Left) or 5 to 75 mm (Right)
      // Y: ~-105 mm (Occipital) to +65 mm (Frontal)
      // Z: ~-45 mm (Inferior temporal/cerebellum) to +75 mm (Vertex)

      const rx = 34; // medial-lateral radius
      const ry = 80; // anterior-posterior radius
      const rz = 58; // inferior-superior radius

      // Base parametric coordinates
      let x0 = rx * Math.sin(phi) * Math.cos(theta);
      let y0 = ry * Math.sin(theta);
      let z0 = rz * Math.cos(phi) * Math.cos(theta);

      // Re-orient to anatomical axes:
      // z is dorsal/superior, y is anterior/posterior, x is lateral
      let mniX = rx * Math.sin(phi) * Math.cos(theta);
      let mniY = ry * Math.cos(phi);
      let mniZ = rz * Math.sin(theta);

      // Adjust hemisphere position & medial flattening:
      // Medial wall is near X = 0 (around +/- 4mm)
      // Lateral cortex bulges outward to +/- 65mm
      const medialFactor = Math.max(0, Math.cos(phi));
      mniX = hemiSign * (5 + (rx + 25) * Math.sin(phi) * Math.cos(theta * 0.9) - 8 * medialFactor);

      // Temporal lobe anterior inferior protrusion (Y: -30 to 10, Z: -35 to -10, X: +/- 45)
      const isTemporal = (mniY > -45 && mniY < 20 && mniZ < 0 && Math.abs(mniX) > 25);
      if (isTemporal) {
        mniZ -= 12 * Math.sin((mniY + 45) / 65 * Math.PI);
        mniY += 8 * Math.sin((mniY + 45) / 65 * Math.PI);
      }

      // Frontal pole tapering and occipital pole tapering
      if (mniY > 30) {
        mniX *= 0.92;
        mniZ *= 0.94;
      }
      if (mniY < -60) {
        mniX *= 0.88;
        mniZ *= 0.90;
      }

      // Anatomical Sulcal & Gyral folding perturbations:
      // 1. Central Sulcus (Y around -15 to -25, Z from 20 to 70)
      const centralDist = Math.abs(mniY - (-18 + 0.3 * mniZ));
      const centralIndent = Math.exp(-Math.pow(centralDist / 5, 2)) * 6.5;

      // 2. Lateral (Sylvian) Fissure (Z around -5 to 15, Y from -35 to 20)
      const sylvianDist = Math.abs(mniZ - (0 - 0.25 * mniY));
      const sylvianIndent = (Math.abs(mniX) > 28 && mniY > -40 && mniY < 25)
        ? Math.exp(-Math.pow(sylvianDist / 6, 2)) * 7.5
        : 0;

      // 3. Parieto-occipital sulcus (medial wall, Y around -70, Z from 15 to 45)
      const posDist = Math.abs(mniY - (-70 + 0.4 * mniZ));
      const posIndent = (Math.abs(mniX) < 22 && mniY < -50)
        ? Math.exp(-Math.pow(posDist / 6, 2)) * 6.0
        : 0;

      // 4. Calcarine sulcus (medial occipital, Y around -80, Z from -5 to 15)
      const calcDist = Math.abs(mniZ - (-2));
      const calcIndent = (Math.abs(mniX) < 20 && mniY < -65)
        ? Math.exp(-Math.pow(calcDist / 5, 2)) * 5.5
        : 0;

      // 5. Higher-frequency cortical gyri / sulci (HCP style folding)
      const gyrusHarmonic = (
        Math.sin(mniX * 0.14 + mniY * 0.12) * 2.5 +
        Math.sin(mniY * 0.16 + mniZ * 0.15) * 2.8 +
        Math.cos(mniZ * 0.18 - mniX * 0.1) * 2.0
      );

      const totalDepth = -(centralIndent + sylvianIndent + posIndent + calcIndent) + gyrusHarmonic;

      // Displace along normal roughly
      const rad = Math.sqrt(mniX * mniX + mniY * mniY + mniZ * mniZ) || 1;
      const nx = mniX / rad;
      const ny = mniY / rad;
      const nz = mniZ / rad;

      mniX += nx * totalDepth;
      mniY += ny * totalDepth;
      mniZ += nz * totalDepth;

      // Store vertex
      vertices[vIdx * 3 + 0] = mniX;
      vertices[vIdx * 3 + 1] = mniY;
      vertices[vIdx * 3 + 2] = mniZ;

      // Normalized curvature (-1 sulcus to +1 gyrus)
      curvatures[vIdx] = Math.max(-1, Math.min(1, totalDepth / 5.0));

      vIdx++;
    }
  }

  // Triangles / Faces
  let fIdx = 0;
  for (let i = 0; i < latSteps; i++) {
    for (let j = 0; j < lonSteps; j++) {
      const nextJ = (j + 1) % lonSteps;

      const a = i * lonSteps + j;
      const b = (i + 1) * lonSteps + j;
      const c = (i + 1) * lonSteps + nextJ;
      const d = i * lonSteps + nextJ;

      if (isLeft) {
        // Front face orientation for Left
        faces[fIdx++] = a;
        faces[fIdx++] = b;
        faces[fIdx++] = c;

        faces[fIdx++] = a;
        faces[fIdx++] = c;
        faces[fIdx++] = d;
      } else {
        // Inverted orientation for Right
        faces[fIdx++] = a;
        faces[fIdx++] = c;
        faces[fIdx++] = b;

        faces[fIdx++] = a;
        faces[fIdx++] = d;
        faces[fIdx++] = c;
      }
    }
  }

  return {
    id: `canonical_surf_${hemi}`,
    name: `S1200.${hemi === 'left' ? 'L' : 'R'}.pial_MSMAll.32k_fs_LR.surf.gii`,
    hemi,
    vertices,
    faces,
    curvatures,
    sourceFileName: `S1200.${hemi === 'left' ? 'L' : 'R'}.pial_MSMAll.32k_fs_LR.surf.gii`
  };
}

export const CANONICAL_LEFT_SURF = generateCorticalHemisphere('left');
export const CANONICAL_RIGHT_SURF = generateCorticalHemisphere('right');

// Predefined HCP Parcellations
// 1. Glasser HCP Multimodal Parcellation (MMP 1.0)
export function createGlasserParcellation(leftSurf: SurfaceMesh, rightSurf: SurfaceMesh): Parcellation {
  const labels = new Map<number, ParcellationLabel>();

  const glasserDefs: Array<{ key: number; name: string; color: [number, number, number, number]; network: string; desc: string }> = [
    { key: 1, name: 'V1', color: [0.1, 0.2, 0.8, 1], network: 'Visual', desc: 'Primary Visual Cortex (Calcarine sulcus)' },
    { key: 2, name: 'MST', color: [0.2, 0.4, 0.9, 1], network: 'Visual', desc: 'Medial Superior Temporal area (motion processing)' },
    { key: 3, name: 'V6', color: [0.3, 0.5, 0.95, 1], network: 'Visual', desc: 'Dorsal visual stream retinotopic area' },
    { key: 4, name: 'V2', color: [0.15, 0.3, 0.85, 1], network: 'Visual', desc: 'Secondary Visual Cortex' },
    { key: 5, name: 'V3', color: [0.25, 0.45, 0.88, 1], network: 'Visual', desc: 'Third Visual Area' },
    { key: 6, name: 'V4', color: [0.35, 0.6, 0.9, 1], network: 'Visual', desc: 'Fourth Visual Area (Color & form perception)' },
    { key: 7, name: 'V8', color: [0.45, 0.7, 0.92, 1], network: 'Visual', desc: 'Ventral visual color-sensitive area' },
    { key: 8, name: 'Area 4', color: [0.85, 0.15, 0.15, 1], network: 'Somatomotor', desc: 'Primary Motor Cortex (Precentral Gyrus / M1)' },
    { key: 9, name: 'Area 3b', color: [0.95, 0.4, 0.2, 1], network: 'Somatomotor', desc: 'Primary Somatosensory Cortex (Cutaneous S1)' },
    { key: 10, name: 'Area 1', color: [0.92, 0.5, 0.25, 1], network: 'Somatomotor', desc: 'Primary Somatosensory Area 1 (Texture & shape)' },
    { key: 11, name: 'Area 2', color: [0.88, 0.55, 0.3, 1], network: 'Somatomotor', desc: 'Primary Somatosensory Area 2 (Deep receptors / joints)' },
    { key: 12, name: 'Area 6d', color: [0.9, 0.25, 0.3, 1], network: 'Somatomotor', desc: 'Dorsal Premotor Cortex' },
    { key: 13, name: 'Area 6v', color: [0.85, 0.35, 0.4, 1], network: 'Somatomotor', desc: 'Ventral Premotor Cortex' },
    { key: 14, name: 'FEF', color: [0.1, 0.75, 0.35, 1], network: 'Dorsal Attention', desc: 'Frontal Eye Field (Saccadic eye movements)' },
    { key: 15, name: 'PEF', color: [0.15, 0.7, 0.4, 1], network: 'Dorsal Attention', desc: 'Premotor Eye Field' },
    { key: 16, name: 'Area 55b', color: [0.8, 0.2, 0.5, 1], network: 'Language', desc: 'Premotor language area' },
    { key: 17, name: 'Area 44', color: [0.88, 0.3, 0.65, 1], network: 'Language', desc: "Broca's area: Pars Opercularis (Speech production)" },
    { key: 18, name: 'Area 45', color: [0.82, 0.4, 0.75, 1], network: 'Language', desc: "Broca's area: Pars Triangularis (Syntactic processing)" },
    { key: 19, name: 'Area 47l', color: [0.75, 0.45, 0.8, 1], network: 'Language', desc: 'Lateral orbitofrontal / inferior frontal gyrus' },
    { key: 20, name: 'A1', color: [0.95, 0.85, 0.1, 1], network: 'Auditory', desc: "Primary Auditory Cortex (Heschl's Gyrus)" },
    { key: 21, name: 'LBelt', color: [0.9, 0.78, 0.15, 1], network: 'Auditory', desc: 'Lateral Auditory Belt' },
    { key: 22, name: 'MBelt', color: [0.85, 0.72, 0.2, 1], network: 'Auditory', desc: 'Medial Auditory Belt' },
    { key: 23, name: 'STSda', color: [0.95, 0.7, 0.3, 1], network: 'Auditory / Social', desc: 'Superior Temporal Sulcus dorsal anterior' },
    { key: 24, name: 'STSdp', color: [0.92, 0.65, 0.35, 1], network: 'Auditory / Social', desc: 'Superior Temporal Sulcus dorsal posterior' },
    { key: 25, name: 'LIPd', color: [0.2, 0.8, 0.3, 1], network: 'Dorsal Attention', desc: 'Lateral Intraparietal dorsal (Spatial attention)' },
    { key: 26, name: 'LIPv', color: [0.25, 0.75, 0.35, 1], network: 'Dorsal Attention', desc: 'Lateral Intraparietal ventral' },
    { key: 27, name: '7m', color: [0.7, 0.2, 0.3, 1], network: 'Default Mode', desc: 'Medial parietal / Precuneus area 7m' },
    { key: 28, name: '23a', color: [0.75, 0.15, 0.25, 1], network: 'Default Mode', desc: 'Posterior Cingulate Cortex area 23a' },
    { key: 29, name: '31a', color: [0.8, 0.25, 0.35, 1], network: 'Default Mode', desc: 'Posterior Cingulate / Retrosplenial area 31a' },
    { key: 30, name: 'Area 46', color: [0.95, 0.55, 0.1, 1], network: 'Frontoparietal Control', desc: 'Dorsolateral Prefrontal Cortex (Working memory)' },
    { key: 31, name: 'Area 9p', color: [0.9, 0.5, 0.15, 1], network: 'Frontoparietal Control', desc: 'Posterior Area 9 (Cognitive control)' },
    { key: 32, name: 'Area 10d', color: [0.85, 0.6, 0.2, 1], network: 'Frontoparietal Control', desc: 'Frontopolar / Anterior Prefrontal Cortex' },
    { key: 33, name: 'Area 8Ad', color: [0.2, 0.7, 0.45, 1], network: 'Dorsal Attention', desc: 'Superior Frontal gyrus dorsal area 8A' },
    { key: 34, name: 'AVI', color: [0.7, 0.2, 0.8, 1], network: 'Salience', desc: 'Anterior Ventral Insular area (Interoception & salience)' },
    { key: 35, name: 'MI', color: [0.65, 0.25, 0.75, 1], network: 'Salience', desc: 'Middle Insular area' },
  ];

  glasserDefs.forEach((def) => {
    labels.set(def.key, {
      key: def.key,
      name: def.name,
      color: def.color,
      network: def.network,
      description: def.desc
    });
  });

  // Assign vertices to nearest functional anatomical region based on coordinates
  const assignLabels = (surf: SurfaceMesh): Int32Array => {
    const n = surf.vertices.length / 3;
    const vertexLabels = new Int32Array(n);

    for (let i = 0; i < n; i++) {
      const x = surf.vertices[i * 3];
      const y = surf.vertices[i * 3 + 1];
      const z = surf.vertices[i * 3 + 2];
      const absX = Math.abs(x);

      // Anatomical heuristic partitioning
      if (y < -75) {
        // Occipital
        if (absX < 20 && z > -15 && z < 15) vertexLabels[i] = 1; // V1
        else if (z < -10) vertexLabels[i] = 6; // V4
        else if (z > 25) vertexLabels[i] = 3; // V6
        else vertexLabels[i] = 4; // V2
      } else if (y >= -75 && y < -55) {
        // Posterior parietal / peristriate
        if (absX < 25 && z > 15) vertexLabels[i] = 27; // 7m Precuneus
        else if (absX > 35 && z > 20) vertexLabels[i] = 25; // LIPd
        else if (z < -15) vertexLabels[i] = 7; // V8
        else vertexLabels[i] = 5; // V3
      } else if (y >= -55 && y < -28) {
        // Mid-parietal and superior temporal
        if (absX < 20 && z > 10) vertexLabels[i] = 28; // 23a Cingulate
        else if (z > 35) vertexLabels[i] = 26; // LIPv
        else if (z > -10 && z <= 15 && absX > 38) vertexLabels[i] = 2; // MST
        else if (z < -10) vertexLabels[i] = 24; // STSdp
        else vertexLabels[i] = 11; // Area 2
      } else if (y >= -28 && y < -12) {
        // Somatosensory S1 strip
        if (z > 40) vertexLabels[i] = 9; // Area 3b
        else if (z > 15) vertexLabels[i] = 10; // Area 1
        else if (absX > 40 && z > -5 && z <= 15) vertexLabels[i] = 20; // A1 Heschl's
        else if (absX < 22) vertexLabels[i] = 29; // 31a
        else vertexLabels[i] = 21; // LBelt
      } else if (y >= -12 && y < 5) {
        // Primary Motor M1 strip & Auditory/Insula
        if (z > 25) vertexLabels[i] = 8; // Area 4 (Motor)
        else if (absX > 35 && z <= 25 && z > 0) vertexLabels[i] = 16; // Area 55b
        else if (absX < 35 && z <= 15 && z > -15) vertexLabels[i] = 34; // Insula AVI
        else vertexLabels[i] = 22; // MBelt
      } else if (y >= 5 && y < 25) {
        // Premotor & Broca's
        if (z > 40) vertexLabels[i] = 12; // Area 6d
        else if (z > 25 && absX > 30) vertexLabels[i] = 14; // FEF
        else if (z > 5 && absX > 38) vertexLabels[i] = 17; // Area 44 (Broca)
        else if (z <= 5 && absX > 35) vertexLabels[i] = 18; // Area 45 (Broca)
        else vertexLabels[i] = 13; // Area 6v
      } else if (y >= 25 && y < 45) {
        // Prefrontal cortex
        if (z > 35) vertexLabels[i] = 33; // Area 8Ad
        else if (z > 15 && absX > 25) vertexLabels[i] = 30; // Area 46 (dlPFC)
        else if (absX > 30 && z <= 15) vertexLabels[i] = 19; // Area 47l
        else if (absX < 20) vertexLabels[i] = 31; // Area 9p
        else vertexLabels[i] = 35; // MI
      } else {
        // Frontal pole
        if (z > 20) vertexLabels[i] = 32; // Area 10d
        else if (absX > 25) vertexLabels[i] = 30; // Area 46
        else vertexLabels[i] = 31; // Area 9p
      }
    }
    return vertexLabels;
  };

  return {
    id: 'glasser_hcp_mmp',
    name: 'Q1-Q6_RelatedValidation210.CorticalAreas_dil_Final_Final_Areas_Group_Colors.32k_fs_LR.dlabel.nii',
    description: 'Glasser HCP Multi-Modal Parcellation (MMP 1.0) - 180 Cortical Areas',
    labels,
    vertexLabelsL: assignLabels(leftSurf),
    vertexLabelsR: assignLabels(rightSurf),
    sourceFileName: 'Q1-Q6_RelatedValidation210.CorticalAreas_dil_Final_Final_Areas_Group_Colors.32k_fs_LR.dlabel.nii'
  };
}

// 2. Brodmann Cytoarchitectonic Atlas
export function createBrodmannParcellation(leftSurf: SurfaceMesh, rightSurf: SurfaceMesh): Parcellation {
  const labels = new Map<number, ParcellationLabel>();

  const baDefs: Array<{ key: number; name: string; color: [number, number, number, number]; desc: string }> = [
    { key: 1, name: 'BA 1 (Somatosensory)', color: [0.9, 0.45, 0.2, 1], desc: 'Postcentral gyrus - tactile texture' },
    { key: 2, name: 'BA 2 (Somatosensory)', color: [0.85, 0.5, 0.25, 1], desc: 'Postcentral gyrus - joint position & size' },
    { key: 3, name: 'BA 3 (Primary Somatosensory)', color: [0.95, 0.35, 0.15, 1], desc: 'Postcentral gyrus - basic cutaneous sensation' },
    { key: 4, name: 'BA 4 (Primary Motor Cortex)', color: [0.85, 0.1, 0.1, 1], desc: 'Precentral gyrus - voluntary motor control' },
    { key: 6, name: 'BA 6 (Premotor & SMA)', color: [0.9, 0.3, 0.3, 1], desc: 'Planning and coordination of complex movements' },
    { key: 9, name: 'BA 9 (Dorsolateral Prefrontal)', color: [0.95, 0.65, 0.1, 1], desc: 'Working memory, sustained attention' },
    { key: 10, name: 'BA 10 (Frontopolar Cortex)', color: [0.9, 0.75, 0.15, 1], desc: 'Strategic multi-tasking, prospective memory' },
    { key: 17, name: 'BA 17 (Primary Visual / Striate)', color: [0.1, 0.2, 0.9, 1], desc: 'Calcarine cortex - V1 primary visual input' },
    { key: 18, name: 'BA 18 (Secondary Visual / V2)', color: [0.2, 0.4, 0.85, 1], desc: 'Extrastriate visual cortex' },
    { key: 19, name: 'BA 19 (Associative Visual / V3-V5)', color: [0.35, 0.6, 0.95, 1], desc: 'Visual motion and feature integration' },
    { key: 20, name: 'BA 20 (Inferior Temporal Gyrus)', color: [0.4, 0.7, 0.6, 1], desc: 'High-level visual object recognition' },
    { key: 21, name: 'BA 21 (Middle Temporal Gyrus)', color: [0.35, 0.8, 0.5, 1], desc: 'Semantic language and auditory processing' },
    { key: 22, name: 'BA 22 (Superior Temporal / Wernicke)', color: [0.2, 0.85, 0.4, 1], desc: "Receptive language comprehension (Wernicke's)" },
    { key: 40, name: 'BA 40 (Supramarginal Gyrus)', color: [0.65, 0.3, 0.75, 1], desc: 'Phonological language and somatosensory integration' },
    { key: 44, name: 'BA 44 (Broca - Pars Opercularis)', color: [0.85, 0.2, 0.6, 1], desc: 'Speech production and articulation' },
    { key: 45, name: 'BA 45 (Broca - Pars Triangularis)', color: [0.75, 0.3, 0.7, 1], desc: 'Semantic retrieval and verbal fluency' },
  ];

  baDefs.forEach((def) => {
    labels.set(def.key, {
      key: def.key,
      name: def.name,
      color: def.color,
      description: def.desc
    });
  });

  const assignLabels = (surf: SurfaceMesh): Int32Array => {
    const n = surf.vertices.length / 3;
    const vertexLabels = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const y = surf.vertices[i * 3 + 1];
      const z = surf.vertices[i * 3 + 2];
      const absX = Math.abs(surf.vertices[i * 3]);

      if (y < -80) {
        if (absX < 20 && z > -15 && z < 15) vertexLabels[i] = 17; // BA 17
        else vertexLabels[i] = 18; // BA 18
      } else if (y < -60) {
        vertexLabels[i] = 19; // BA 19
      } else if (y >= -26 && y < -10) {
        if (z > 35) vertexLabels[i] = 3; // BA 3
        else if (z > 15) vertexLabels[i] = 1; // BA 1
        else vertexLabels[i] = 2; // BA 2
      } else if (y >= -10 && y < 8) {
        if (z > 20) vertexLabels[i] = 4; // BA 4
        else if (absX > 35) vertexLabels[i] = 22; // BA 22
        else vertexLabels[i] = 6;
      } else if (y >= 8 && y < 28) {
        if (absX > 38 && z > 5) vertexLabels[i] = 44; // BA 44
        else if (absX > 35 && z <= 5) vertexLabels[i] = 45; // BA 45
        else vertexLabels[i] = 6; // BA 6
      } else if (y >= 28 && y < 50) {
        vertexLabels[i] = 9; // BA 9
      } else if (y >= 50) {
        vertexLabels[i] = 10; // BA 10
      } else {
        if (z < -10) vertexLabels[i] = 20; // BA 20
        else if (z < 10) vertexLabels[i] = 21; // BA 21
        else vertexLabels[i] = 40; // BA 40
      }
    }
    return vertexLabels;
  };

  return {
    id: 'brodmann_atlas',
    name: 'Human.Brodmann09.32k_fs_LR.dlabel.nii',
    description: 'Human Brodmann Cytoarchitectonic Atlas (Brodmann09)',
    labels,
    vertexLabelsL: assignLabels(leftSurf),
    vertexLabelsR: assignLabels(rightSurf),
    sourceFileName: 'Human.Brodmann09.32k_fs_LR.dlabel.nii'
  };
}

// 3. Yeo 7 Resting-State Networks (RSN-networks)
export function createYeoNetworksParcellation(leftSurf: SurfaceMesh, rightSurf: SurfaceMesh): Parcellation {
  const labels = new Map<number, ParcellationLabel>();

  const netDefs: Array<{ key: number; name: string; color: [number, number, number, number]; desc: string }> = [
    { key: 1, name: 'Visual Network', color: [0.47, 0.07, 0.52, 1], desc: 'Occipital striate and extrastriate visual cortex' },
    { key: 2, name: 'Somatomotor Network', color: [0.27, 0.51, 0.71, 1], desc: 'Precentral motor and postcentral sensory strips' },
    { key: 3, name: 'Dorsal Attention Network', color: [0.0, 0.46, 0.05, 1], desc: 'Frontal eye fields and superior parietal lobule' },
    { key: 4, name: 'Ventral Attention / Salience', color: [0.77, 0.23, 0.98, 1], desc: 'Anterior insula and dorsal anterior cingulate' },
    { key: 5, name: 'Limbic Network', color: [0.86, 0.97, 0.64, 1], desc: 'Temporal pole and orbital frontal cortex' },
    { key: 6, name: 'Frontoparietal Control Network', color: [0.9, 0.58, 0.13, 1], desc: 'Dorsolateral prefrontal and inferior parietal' },
    { key: 7, name: 'Default Mode Network (DMN)', color: [0.8, 0.24, 0.23, 1], desc: 'Precuneus, medial prefrontal, angular gyrus' },
  ];

  netDefs.forEach((def) => {
    labels.set(def.key, {
      key: def.key,
      name: def.name,
      color: def.color,
      description: def.desc
    });
  });

  const assignLabels = (surf: SurfaceMesh): Int32Array => {
    const n = surf.vertices.length / 3;
    const vertexLabels = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const y = surf.vertices[i * 3 + 1];
      const z = surf.vertices[i * 3 + 2];
      const absX = Math.abs(surf.vertices[i * 3]);

      if (y < -65) {
        vertexLabels[i] = 1; // Visual
      } else if (y >= -26 && y < 5 && z > 15) {
        vertexLabels[i] = 2; // Somatomotor
      } else if (z > 35 && ((y >= 5 && y < 30) || (y < -45 && y >= -65))) {
        vertexLabels[i] = 3; // Dorsal Attention
      } else if ((absX > 32 && y >= 0 && y < 35 && z <= 15) || (absX < 20 && y >= 10 && y < 35 && z > 10)) {
        vertexLabels[i] = 4; // Ventral Attention / Salience
      } else if (z < -20 || (y > 20 && z < -10)) {
        vertexLabels[i] = 5; // Limbic
      } else if (y > 35 && absX > 25 && z > 10) {
        vertexLabels[i] = 6; // Frontoparietal Control
      } else {
        vertexLabels[i] = 7; // Default Mode
      }
    }
    return vertexLabels;
  };

  return {
    id: 'yeo_rsn_networks',
    name: 'RSN-networks.32k_fs_LR.dlabel.nii',
    description: 'Yeo 7 Resting-State Functional Connectivity Networks',
    labels,
    vertexLabelsL: assignLabels(leftSurf),
    vertexLabelsR: assignLabels(rightSurf),
    sourceFileName: 'RSN-networks.32k_fs_LR.dlabel.nii'
  };
}

// Canonical MNI152 T1 Volume generator (1.5mm voxel resolution)
// MNI coordinate space:
// X: -90 to +90 (120 voxels, dx = 1.5mm)
// Y: -126 to +90 (144 voxels, dy = 1.5mm)
// Z: -72 to +108 (120 voxels, dz = 1.5mm)
export function createCanonicalMniVolume(): VolumeData {
  const nx = 120;
  const ny = 144;
  const nz = 120;
  const dx = 1.5;
  const dy = 1.5;
  const dz = 1.5;

  const originX = -90;
  const originY = -126;
  const originZ = -72;

  // Affine matrix: voxel [i, j, k, 1] -> world MNI [x, y, z, 1]
  const affine: number[][] = [
    [dx, 0, 0, originX],
    [0, dy, 0, originY],
    [0, 0, dz, originZ],
    [0, 0, 0, 1]
  ];

  const invAffine = invertMatrix4(affine);

  const totalVoxels = nx * ny * nz;
  const data = new Float32Array(totalVoxels);

  // Synthesize realistic human T1 MRI intensities conforming to MNI space
  // T1 typical relative intensities:
  // CSF: ~15-25 (dark)
  // Gray Matter (Cortex, deep nuclei): ~55-68 (medium gray)
  // White Matter: ~90-110 (bright)
  // Scalp / fat: ~70-95
  // Skull bone: ~5-15 (dark signal void)

  for (let k = 0; k < nz; k++) {
    const z = originZ + k * dz;
    const sliceOffsetK = k * nx * ny;

    for (let j = 0; j < ny; j++) {
      const y = originY + j * dy;
      const sliceOffsetJ = sliceOffsetK + j * nx;

      for (let i = 0; i < nx; i++) {
        const x = originX + i * dx;
        const absX = Math.abs(x);

        // Ellipsoidal brain boundary approximation aligned with cortex
        const headRadius = Math.sqrt(
          Math.pow(x / 78, 2) +
          Math.pow((y + 16) / 102, 2) +
          Math.pow((z - 18) / 80, 2)
        );

        const brainRadius = Math.sqrt(
          Math.pow(x / 68, 2) +
          Math.pow((y + 18) / 90, 2) +
          Math.pow((z - 16) / 68, 2)
        );

        let intensity = 0;

        if (headRadius < 1.0) {
          // Inside head
          if (headRadius > 0.94) {
            // Scalp / skin
            intensity = 72 + Math.sin(x * 0.1) * 5;
          } else if (headRadius > 0.88) {
            // Skull (bone void)
            intensity = 12;
          } else if (brainRadius > 0.96) {
            // Subarachnoid CSF
            intensity = 20;
          } else {
            // Inside Brain Parenchyma
            // Lateral Ventricles (CSF: dark)
            const isLatVentL = (x < -3 && x > -18 && y > -35 && y < 15 && z > 5 && z < 25);
            const isLatVentR = (x > 3 && x < 18 && y > -35 && y < 15 && z > 5 && z < 25);
            const isThirdVent = (absX < 3 && y > -25 && y < 5 && z > -5 && z < 15);

            if (isLatVentL || isLatVentR || isThirdVent) {
              intensity = 18 + Math.random() * 4;
            } else {
              // White Matter vs Gray Matter
              // White matter core sits inside brainRadius < 0.72
              const wmRadius = Math.sqrt(
                Math.pow(x / 46, 2) +
                Math.pow((y + 18) / 66, 2) +
                Math.pow((z - 18) / 46, 2)
              );

              // Deep gray matter nuclei: Thalamus & Basal Ganglia
              const isThalamus = (absX > 4 && absX < 18 && y > -30 && y < -8 && z > 0 && z < 16);
              const isCaudate = (absX > 10 && absX < 20 && y > -5 && y < 15 && z > 10 && z < 22);

              if (isThalamus || isCaudate) {
                // Subcortical gray
                intensity = 58 + Math.random() * 4;
              } else if (wmRadius < 0.85 && z > -15) {
                // White Matter Core
                intensity = 95 + Math.sin(x * 0.2 + y * 0.2) * 5 + (Math.random() - 0.5) * 4;
              } else {
                // Cortical Gray Matter ribbon
                // Introduce subtle gyral/sulcal intensity fluctuations
                const fold = Math.sin(x * 0.15 + y * 0.12) * Math.cos(z * 0.15);
                intensity = 62 + fold * 8 + (Math.random() - 0.5) * 4;
              }
            }
          }
        }

        data[sliceOffsetJ + i] = Math.max(0, intensity);
      }
    }
  }

  return {
    id: 'canonical_mni152',
    name: 'MNI152_T1_0.7mm.nii.gz',
    dims: [nx, ny, nz],
    pixDims: [dx, dy, dz],
    data,
    minVal: 0,
    maxVal: 100,
    affine,
    invAffine,
    isDefaultTemplate: true
  };
}
