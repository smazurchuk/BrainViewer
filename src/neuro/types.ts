export interface WorldCoord {
  x: number; // Left (-) to Right (+)
  y: number; // Posterior (-) to Anterior (+)
  z: number; // Inferior (-) to Superior (+)
}

export interface VoxelCoord {
  i: number;
  j: number;
  k: number;
}

export interface VolumeData {
  id: string;
  name: string;
  dims: [number, number, number]; // [nx, ny, nz]
  pixDims: [number, number, number]; // voxel sizes in mm [dx, dy, dz]
  data: Float32Array | Int16Array | Uint8Array;
  minVal: number;
  maxVal: number;
  affine: number[][]; // 4x4 matrix: voxel [i, j, k, 1] -> world [x, y, z, 1]
  invAffine: number[][]; // 4x4 matrix: world [x, y, z, 1] -> voxel [i, j, k, 1]
  isDefaultTemplate?: boolean;
}

export interface SurfaceMesh {
  id: string;
  name: string;
  hemi: 'left' | 'right';
  vertices: Float32Array; // 3 * N coordinates in MNI mm
  faces: Uint32Array; // 3 * M vertex indices
  normals?: Float32Array;
  curvatures?: Float32Array; // sulcal depth / curvature
  labels?: Int32Array; // region label index per vertex
  sourceFileName?: string;
}

export interface ParcellationLabel {
  key: number;
  name: string;
  color: [number, number, number, number]; // [r, g, b, a] in 0..1
  network?: string;
  hemi?: 'L' | 'R';
  description?: string;
}

export interface Parcellation {
  id: string;
  name: string;
  description: string;
  labels: Map<number, ParcellationLabel>;
  vertexLabelsL?: Int32Array;
  vertexLabelsR?: Int32Array;
  sourceFileName?: string;
}

export interface FiduciaryMarker {
  coord: WorldCoord;
  surfacePoint: WorldCoord;
  surfaceDistance: number; // Euclidean distance in mm to nearest surface vertex
  vertexIndex: number;
  hemi: 'left' | 'right';
  activeLabel?: ParcellationLabel;
  sourceView: 'surface_3d' | 'slice_contour' | 'manual' | 'landmark';
  timestamp: number;
}

export interface CrosshairState {
  mni: WorldCoord;
  nearestSurfacePoint?: WorldCoord;
  surfaceDistance?: number; // Euclidean distance in mm to nearest surface vertex
  nearestVertexIndex?: number;
  nearestHemi?: 'left' | 'right';
  activeLabel?: ParcellationLabel;
  sourceView: 'surface' | 'axial' | 'coronal' | 'sagittal' | 'manual' | 'preset';
}

export type ViewLayout = 'quad' | 'surface_focus' | 'slices_focus' | 'split_axial';

export type ColormapType = 'grayscale' | 'inverted' | 'hot' | 'bone' | 'jet' | 'coolwarm';

export type FitMode = 'fill' | 'fit' | 'brain_focus';

export interface ViewerOverlaySettings {
  showCrosshairs: boolean;
  showSurfaceContours: boolean;
  showOrientationLabels: boolean;
  colormap: ColormapType;
  windowWidth: number;
  windowLevel: number;
  fitMode: FitMode;
  zoomLevel: number;
}
