import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SurfaceMesh, Parcellation, WorldCoord, CrosshairState, FiduciaryMarker } from '../neuro/types';
import {
  RotateCcw,
  Camera,
  Maximize2,
  Minimize2,
  Layers,
  Eye,
  Crosshair,
  Sparkles
} from 'lucide-react';

/** Focus target with a sequence counter to ensure repeated coordinates re-trigger animation */
export interface FocusTarget {
  coord: WorldCoord;
  seq: number;
}

interface CameraAnimation {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  frame: number;
  totalFrames: number;
}

/** EaseInOutCubic for smooth, professional camera transitions */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface ThreeBrainViewerProps {
  leftSurface: SurfaceMesh | null;
  rightSurface: SurfaceMesh | null;
  parcellation: Parcellation | null;
  activeColorMode: 'parcellation' | 'curvature' | 'solid';
  crosshair: CrosshairState;
  fiduciaryMarker?: FiduciaryMarker | null;
  onSurfacePointClicked?: (coord: WorldCoord, vertexIndex: number, hemi: 'left' | 'right') => void;
  onSurfacePointDoubleClicked?: (coord: WorldCoord, vertexIndex: number, hemi: 'left' | 'right') => void;
  showMarkerOnSurface?: boolean;
  focusTarget?: FocusTarget | null;
  onReady?: () => void;
}

export const ThreeBrainViewer: React.FC<ThreeBrainViewerProps> = ({
  leftSurface,
  rightSurface,
  parcellation,
  activeColorMode,
  crosshair,
  fiduciaryMarker,
  onSurfacePointClicked,
  onSurfacePointDoubleClicked,
  showMarkerOnSurface = true,
  focusTarget,
  onReady
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const leftMeshRef = useRef<THREE.Mesh | null>(null);
  const rightMeshRef = useRef<THREE.Mesh | null>(null);

  const markerGroupRef = useRef<THREE.Group | null>(null);
  const surfacePinMeshRef = useRef<THREE.Mesh | null>(null);
  const connectorLineRef = useRef<THREE.Line | null>(null);

  const [hemiVisibility, setHemiVisibility] = useState<'both' | 'left' | 'right'>('both');
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [hoveredInfo, setHoveredInfo] = useState<string | null>(null);

  // Camera animation state for smooth focus transitions
  const cameraAnimRef = useRef<CameraAnimation | null>(null);
  const lastFocusSeqRef = useRef<number>(-1);

  // Pointer tracking for click vs orbit
  const pointerDownPosRef = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });

  // Update vertex colors on geometry based on mode & parcellation
  const updateVertexColors = useCallback(
    (mesh: THREE.Mesh | null, surf: SurfaceMesh | null, hemi: 'left' | 'right') => {
      if (!mesh || !surf) return;
      const geom = mesh.geometry as THREE.BufferGeometry;
      const n = surf.vertices.length / 3;

      let colorAttr = geom.getAttribute('color') as THREE.BufferAttribute;
      if (!colorAttr || colorAttr.count !== n) {
        colorAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
        geom.setAttribute('color', colorAttr);
      }

      const colors = colorAttr.array as Float32Array;

      const vertexLabels =
        hemi === 'left' ? parcellation?.vertexLabelsL : parcellation?.vertexLabelsR;

      for (let i = 0; i < n; i++) {
        if (activeColorMode === 'parcellation' && parcellation && vertexLabels) {
          const labelKey = vertexLabels[i];
          const labelInfo = parcellation.labels.get(labelKey);

          if (labelInfo && labelInfo.color) {
            const [r, g, b] = labelInfo.color;
            // Modulate slightly by curvature for depth if available
            const curv = surf.curvatures ? (surf.curvatures[i] + 1) * 0.15 + 0.85 : 1.0;
            colors[i * 3 + 0] = Math.min(1, r * curv);
            colors[i * 3 + 1] = Math.min(1, g * curv);
            colors[i * 3 + 2] = Math.min(1, b * curv);
          } else {
            // Default gray
            colors[i * 3 + 0] = 0.65;
            colors[i * 3 + 1] = 0.65;
            colors[i * 3 + 2] = 0.65;
          }
        } else if (activeColorMode === 'curvature' && surf.curvatures) {
          // High-contrast sulci/gyri (Connectome Workbench style)
          // Sulci (curv < 0) are darker, gyri (curv >= 0) are brighter
          const curv = surf.curvatures[i]; // typically -1 to 1
          const val = curv < 0
            ? 0.30 + (curv + 1) * 0.12   // sulci: ~0.30 – 0.42
            : 0.72 + curv * 0.23;          // gyri:  ~0.72 – 0.95
          colors[i * 3 + 0] = val;
          colors[i * 3 + 1] = val;
          colors[i * 3 + 2] = val;
        } else {
          // Solid anatomical warm gray
          colors[i * 3 + 0] = 0.78;
          colors[i * 3 + 1] = 0.76;
          colors[i * 3 + 2] = 0.74;
        }
      }

      colorAttr.needsUpdate = true;
    },
    [activeColorMode, parcellation]
  );

  // Initialize Three.js Scene
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth || 600;
    const height = containerRef.current.clientHeight || 500;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0c); // Deep neutral dark canvas
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, width / height, 1, 2000);
    camera.up.set(0, 0, 1); // Z is superior in MNI space
    camera.position.set(-240, -10, 15); // Left lateral view (wb_view default)
    camera.lookAt(0, -10, 15);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    // Crisp OrbitControls matching wb_view feel: no momentum, direct 1:1 response
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;      // No inertia — stops instantly on release
    controls.rotateSpeed = 1.0;          // Direct, responsive rotation
    controls.zoomSpeed = 1.2;            // Snappy zoom
    controls.panSpeed = 1.0;             // Crisp panning
    controls.minDistance = 40;
    controls.maxDistance = 800;
    controls.target.set(0, -10, 15);
    controlsRef.current = controls;

    // Hemisphere light for natural sky/ground fill (brighter overall)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444466, 0.9);
    scene.add(hemiLight);

    // Ambient light – provides baseline illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Directional light 1 (Front/Superior – key light)
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight1.position.set(120, 200, 260);
    scene.add(dirLight1);

    // Directional light 2 (Back/Lateral fill)
    const dirLight2 = new THREE.DirectionalLight(0xb0bec5, 0.65);
    dirLight2.position.set(-150, -200, -100);
    scene.add(dirLight2);

    // Directional light 3 (Top/Rim – highlights sulcal contours)
    const dirLight3 = new THREE.DirectionalLight(0xffffff, 0.45);
    dirLight3.position.set(0, 0, 300);
    scene.add(dirLight3);

    // 3D Marker Group for Crosshair
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    markerGroupRef.current = markerGroup;

    // Center Crosshair Sphere
    const sphereGeo = new THREE.SphereGeometry(2.8, 24, 24);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee, // cyan-400
      emissive: 0x0891b2,
      emissiveIntensity: 0.8,
      roughness: 0.2
    });
    const markerSphere = new THREE.Mesh(sphereGeo, sphereMat);
    markerGroup.add(markerSphere);

    // Target outer ring
    const ringGeo = new THREE.RingGeometry(4.5, 5.8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const markerRing = new THREE.Mesh(ringGeo, ringMat);
    markerGroup.add(markerRing);

    // Surface Snapped Pin/Marker
    const pinGeo = new THREE.SphereGeometry(2.0, 16, 16);
    const pinMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e, // rose-500
      emissive: 0xe11d48,
      emissiveIntensity: 0.9
    });
    const pinMesh = new THREE.Mesh(pinGeo, pinMat);
    pinMesh.visible = false;
    scene.add(pinMesh);
    surfacePinMeshRef.current = pinMesh;

    // Connector Line between slice crosshair and snapped surface vertex
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0)
    ]);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xfacc15, // yellow-400
      dashSize: 2,
      gapSize: 1.5,
      linewidth: 2
    });
    const connectorLine = new THREE.Line(lineGeo, lineMat);
    connectorLine.computeLineDistances();
    connectorLine.visible = false;
    scene.add(connectorLine);
    connectorLineRef.current = connectorLine;

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Camera focus animation (lerp-based smooth orbit)
      const anim = cameraAnimRef.current;
      if (anim && anim.frame < anim.totalFrames) {
        anim.frame++;
        const t = easeInOutCubic(anim.frame / anim.totalFrames);

        camera.position.lerpVectors(anim.fromPos, anim.toPos, t);
        controls.target.lerpVectors(anim.fromTarget, anim.toTarget, t);
        camera.up.set(0, 0, 1);

        if (anim.frame >= anim.totalFrames) {
          cameraAnimRef.current = null;
        }
      }

      // Smooth damping update
      controls.update();

      // Subtle pulse and rotation on target ring
      if (markerRing) {
        markerRing.rotation.z += 0.015;
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h, false);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Build / Update Left Surface Mesh (only when surface geometry changes)
  useEffect(() => {
    if (!sceneRef.current || !leftSurface) return;

    if (leftMeshRef.current) {
      sceneRef.current.remove(leftMeshRef.current);
      leftMeshRef.current.geometry.dispose();
      (leftMeshRef.current.material as THREE.Material).dispose();
      leftMeshRef.current = null;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(leftSurface.vertices, 3));
    geom.setIndex(new THREE.BufferAttribute(leftSurface.faces, 1));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.32,
      metalness: 0.05,
      wireframe,
      transparent: false,
      opacity: 1.0,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = 'LeftCortex';
    mesh.userData = { hemi: 'left' };
    mesh.visible = hemiVisibility === 'both' || hemiVisibility === 'left';
    sceneRef.current.add(mesh);
    leftMeshRef.current = mesh;

    updateVertexColors(mesh, leftSurface, 'left');

    // Signal ready after first mesh is built and a frame renders
    if (onReady) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          onReady();
        });
      });
    }
  }, [leftSurface]);

  // Build / Update Right Surface Mesh (only when surface geometry changes)
  useEffect(() => {
    if (!sceneRef.current || !rightSurface) return;

    if (rightMeshRef.current) {
      sceneRef.current.remove(rightMeshRef.current);
      rightMeshRef.current.geometry.dispose();
      (rightMeshRef.current.material as THREE.Material).dispose();
      rightMeshRef.current = null;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(rightSurface.vertices, 3));
    geom.setIndex(new THREE.BufferAttribute(rightSurface.faces, 1));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.32,
      metalness: 0.05,
      wireframe,
      transparent: false,
      opacity: 1.0,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = 'RightCortex';
    mesh.userData = { hemi: 'right' };
    mesh.visible = hemiVisibility === 'both' || hemiVisibility === 'right';
    sceneRef.current.add(mesh);
    rightMeshRef.current = mesh;

    updateVertexColors(mesh, rightSurface, 'right');
  }, [rightSurface]);

  // Update material styling (wireframe) in-place without rebuilding geometry
  useEffect(() => {
    if (leftMeshRef.current) {
      const mat = leftMeshRef.current.material as THREE.MeshStandardMaterial;
      mat.wireframe = wireframe;
      mat.needsUpdate = true;
    }
    if (rightMeshRef.current) {
      const mat = rightMeshRef.current.material as THREE.MeshStandardMaterial;
      mat.wireframe = wireframe;
      mat.needsUpdate = true;
    }
  }, [wireframe]);

  // Update hemisphere visibility in-place without rebuilding geometry
  useEffect(() => {
    if (leftMeshRef.current) {
      leftMeshRef.current.visible = hemiVisibility === 'both' || hemiVisibility === 'left';
    }
    if (rightMeshRef.current) {
      rightMeshRef.current.visible = hemiVisibility === 'both' || hemiVisibility === 'right';
    }
  }, [hemiVisibility]);

  // Update vertex colors whenever parcellation or colorMode changes
  useEffect(() => {
    if (leftMeshRef.current && leftSurface) {
      updateVertexColors(leftMeshRef.current, leftSurface, 'left');
    }
    if (rightMeshRef.current && rightSurface) {
      updateVertexColors(rightMeshRef.current, rightSurface, 'right');
    }
  }, [parcellation, activeColorMode, leftSurface, rightSurface, updateVertexColors]);

  // Animate camera to focus on a target coordinate when focusTarget changes
  useEffect(() => {
    if (!focusTarget || !cameraRef.current || !controlsRef.current) return;
    if (focusTarget.seq === lastFocusSeqRef.current) return;
    lastFocusSeqRef.current = focusTarget.seq;

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const { coord } = focusTarget;

    // Brain center in MNI space (matches OrbitControls default target)
    const brainCenter = new THREE.Vector3(0, -10, 15);

    // Target point on the brain — orbit target will move toward the focus coordinate
    // We offset slightly toward brain center so the target stays close to center-of-brain
    // but the camera orbits to view the specific area
    const focusPt = new THREE.Vector3(coord.x, coord.y, coord.z);

    // Orbit target: blend between brain center and the focus point (70% center, 30% focus)
    // This keeps the brain centered while still highlighting the area
    const orbitTarget = new THREE.Vector3().lerpVectors(brainCenter, focusPt, 0.3);

    // Direction from orbit target outward through the focus point — this is the viewing direction
    const outwardDir = new THREE.Vector3().subVectors(focusPt, brainCenter).normalize();

    // If the direction is effectively zero (e.g., clicking at brain center), use default
    if (outwardDir.length() < 0.01) {
      outwardDir.set(-1, -1, 0.5).normalize();
    }

    // Place camera along this direction at current orbit distance (or default 220)
    const currentDist = camera.position.distanceTo(controls.target);
    const dist = Math.max(180, Math.min(currentDist, 300));
    const cameraTarget = new THREE.Vector3().copy(orbitTarget).addScaledVector(outwardDir, dist);

    // Start smooth animation
    cameraAnimRef.current = {
      fromPos: camera.position.clone(),
      toPos: cameraTarget,
      fromTarget: controls.target.clone(),
      toTarget: orbitTarget,
      frame: 0,
      totalFrames: 50, // ~830ms at 60fps
    };
  }, [focusTarget]);

  // Update 3D Fiduciary Marker & Surface Pin when fiduciaryMarker or crosshair updates
  useEffect(() => {
    if (!markerGroupRef.current) return;

    // Use fiduciaryMarker if available, otherwise fall back to crosshair
    const targetCoord = fiduciaryMarker ? fiduciaryMarker.coord : crosshair.mni;
    const targetSurfacePt = fiduciaryMarker ? fiduciaryMarker.surfacePoint : crosshair.nearestSurfacePoint;
    const targetDist = fiduciaryMarker ? fiduciaryMarker.surfaceDistance : crosshair.surfaceDistance;

    if (!showMarkerOnSurface) {
      markerGroupRef.current.visible = false;
      if (surfacePinMeshRef.current) surfacePinMeshRef.current.visible = false;
      if (connectorLineRef.current) connectorLineRef.current.visible = false;
      return;
    }

    markerGroupRef.current.position.set(targetCoord.x, targetCoord.y, targetCoord.z);
    markerGroupRef.current.visible = true;

    if (surfacePinMeshRef.current && connectorLineRef.current) {
      if (targetSurfacePt && targetDist !== undefined && targetDist < 25) {
        surfacePinMeshRef.current.position.set(
          targetSurfacePt.x,
          targetSurfacePt.y,
          targetSurfacePt.z
        );
        surfacePinMeshRef.current.visible = true;

        // Update connector line
        const positions = new Float32Array([
          targetCoord.x, targetCoord.y, targetCoord.z,
          targetSurfacePt.x, targetSurfacePt.y, targetSurfacePt.z
        ]);
        connectorLineRef.current.geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(positions, 3)
        );
        connectorLineRef.current.computeLineDistances();
        connectorLineRef.current.visible = targetDist > 1.5;
      } else {
        surfacePinMeshRef.current.visible = false;
        connectorLineRef.current.visible = false;
      }
    }
  }, [fiduciaryMarker, crosshair, showMarkerOnSurface]);

  // Pointer tracking: cleanly differentiate between drag/orbit vs double-click
  const lastClickTimeRef = useRef<number>(0);
  const lastClickPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastRaycastTimeRef = useRef<number>(0);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const dx = Math.abs(e.clientX - pointerDownPosRef.current.x);
    const dy = Math.abs(e.clientY - pointerDownPosRef.current.y);
    const elapsed = Date.now() - pointerDownPosRef.current.time;

    // Fast click detection for double click (two clicks in < 350ms with minimal drag)
    if (e.button === 0 && dx < 6 && dy < 6 && elapsed < 350) {
      const now = Date.now();
      const distFromLast = Math.hypot(e.clientX - lastClickPosRef.current.x, e.clientY - lastClickPosRef.current.y);
      if (now - lastClickTimeRef.current < 350 && distFromLast < 10) {
        // Double-click confirmed via pointer events
        triggerRaycast(e.clientX, e.clientY);
        lastClickTimeRef.current = 0;
      } else {
        lastClickTimeRef.current = now;
        lastClickPosRef.current = { x: e.clientX, y: e.clientY };
      }
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    triggerRaycast(e.clientX, e.clientY);
  };

  const triggerRaycast = (clientX: number, clientY: number) => {
    // Debounce duplicate triggers within 150ms (from pointerUp + onDoubleClick)
    const now = Date.now();
    if (now - lastRaycastTimeRef.current < 150) return;
    lastRaycastTimeRef.current = now;

    if (!canvasRef.current || !cameraRef.current || !sceneRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);

    const meshes: THREE.Mesh[] = [];
    if (leftMeshRef.current && leftMeshRef.current.visible) meshes.push(leftMeshRef.current);
    if (rightMeshRef.current && rightMeshRef.current.visible) meshes.push(rightMeshRef.current);

    const intersects = raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const clickedPt = hit.point; // In MNI coordinate space
      const hemi = (hit.object.userData.hemi as 'left' | 'right') || 'left';
      const surf = hemi === 'left' ? leftSurface : rightSurface;

      let nearestIdx = 0;
      if (surf && hit.face) {
        // Check vertices of the intersected face
        const verts = surf.vertices;
        const candidateIndices = [hit.face.a, hit.face.b, hit.face.c];
        let minDistSq = Infinity;

        for (const idx of candidateIndices) {
          const vx = verts[idx * 3];
          const vy = verts[idx * 3 + 1];
          const vz = verts[idx * 3 + 2];
          const dsq =
            Math.pow(vx - clickedPt.x, 2) +
            Math.pow(vy - clickedPt.y, 2) +
            Math.pow(vz - clickedPt.z, 2);
          if (dsq < minDistSq) {
            minDistSq = dsq;
            nearestIdx = idx;
          }
        }
      }

      const worldCoord: WorldCoord = { x: clickedPt.x, y: clickedPt.y, z: clickedPt.z };

      if (onSurfacePointDoubleClicked) {
        onSurfacePointDoubleClicked(worldCoord, nearestIdx, hemi);
      } else if (onSurfacePointClicked) {
        onSurfacePointClicked(worldCoord, nearestIdx, hemi);
      }

      // Brief HUD notification banner
      let areaName = `${hemi.toUpperCase()} cortex`;
      if (parcellation) {
        const vLabels = hemi === 'left' ? parcellation.vertexLabelsL : parcellation.vertexLabelsR;
        if (vLabels) {
          const key = vLabels[nearestIdx];
          const label = parcellation.labels.get(key);
          if (label) areaName = label.name;
        }
      }
      setHoveredInfo(`Fiducial marker placed: ${areaName} [${worldCoord.x.toFixed(0)}, ${worldCoord.y.toFixed(0)}, ${worldCoord.z.toFixed(0)}]`);
      setTimeout(() => setHoveredInfo(null), 3500);
    }
  };

  // Anatomical camera presets with smooth orbit control transition
  const setViewPreset = (view: 'lateral_L' | 'medial_L' | 'lateral_R' | 'medial_R' | 'dorsal' | 'ventral' | 'anterior' | 'posterior') => {
    if (!controlsRef.current || !cameraRef.current) return;
    const target = new THREE.Vector3(0, -10, 15);
    controlsRef.current.target.copy(target);
    const dist = 240;

    switch (view) {
      case 'lateral_L':
        cameraRef.current.position.set(-dist, -10, 15);
        setHemiVisibility('both');
        break;
      case 'medial_L':
        cameraRef.current.position.set(dist, -10, 15);
        setHemiVisibility('left');
        break;
      case 'lateral_R':
        cameraRef.current.position.set(dist, -10, 15);
        setHemiVisibility('both');
        break;
      case 'medial_R':
        cameraRef.current.position.set(-dist, -10, 15);
        setHemiVisibility('right');
        break;
      case 'dorsal':
        cameraRef.current.position.set(0, -10, dist + 15);
        setHemiVisibility('both');
        break;
      case 'ventral':
        cameraRef.current.position.set(0, -10, -dist + 15);
        setHemiVisibility('both');
        break;
      case 'anterior':
        cameraRef.current.position.set(0, dist - 10, 15);
        setHemiVisibility('both');
        break;
      case 'posterior':
        cameraRef.current.position.set(0, -dist - 10, 15);
        setHemiVisibility('both');
        break;
    }
    cameraRef.current.up.set(0, 0, 1);
    cameraRef.current.lookAt(target);
    controlsRef.current.update();
  };

  const handleScreenshot = () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    rendererRef.current.render(sceneRef.current, cameraRef.current);
    const dataUrl = rendererRef.current.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `connectome_surface_${Date.now()}.png`;
    a.click();
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => console.error(err));
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch((err) => console.error(err));
      setIsFullscreen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      id="three-brain-viewport"
      className="relative w-full h-full flex flex-col bg-gradient-to-br from-[#09090B] to-[#1E293B] select-none overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Top Overlay Controls Bar (Bento style) */}
      <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-1.5 bg-[#09090B]/90 backdrop-blur border border-[#27272A] rounded p-1 text-xs text-[#FAFAFA] pointer-events-auto shadow-md">
          <div className="flex items-center gap-1 px-1.5 py-0.5 text-[#38BDF8] font-bold text-[10px] uppercase tracking-wider border-r border-[#27272A]">
            <Sparkles className="w-3 h-3" />
            <span>3D SURFACE VIEW</span>
          </div>

          {/* Hemisphere selector */}
          <div className="flex items-center gap-0.5 bg-[#18181B] p-0.5 rounded">
            <button
              id="btn-hemi-both"
              type="button"
              onClick={() => setHemiVisibility('both')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase transition-colors ${
                hemiVisibility === 'both' ? 'bg-[#38BDF8] text-black font-bold shadow-sm' : 'hover:text-white text-[#71717A]'
              }`}
            >
              Both
            </button>
            <button
              id="btn-hemi-left"
              type="button"
              onClick={() => setHemiVisibility('left')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase transition-colors ${
                hemiVisibility === 'left' ? 'bg-[#38BDF8] text-black font-bold shadow-sm' : 'hover:text-white text-[#71717A]'
              }`}
            >
              LH (Left)
            </button>
            <button
              id="btn-hemi-right"
              type="button"
              onClick={() => setHemiVisibility('right')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase transition-colors ${
                hemiVisibility === 'right' ? 'bg-[#38BDF8] text-black font-bold shadow-sm' : 'hover:text-white text-[#71717A]'
              }`}
            >
              RH (Right)
            </button>
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1 bg-[#09090B]/90 backdrop-blur border border-[#27272A] rounded p-1 text-[#A1A1AA] pointer-events-auto shadow-md">
          <button
            id="btn-capture-surface"
            type="button"
            title="Snapshot Surface Image"
            onClick={handleScreenshot}
            className="p-1.5 hover:bg-[#18181B] hover:text-[#FAFAFA] rounded transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
          <button
            id="btn-reset-surface-view"
            type="button"
            title="Reset Camera View"
            onClick={() => setViewPreset('lateral_L')}
            className="p-1.5 hover:bg-[#18181B] hover:text-[#FAFAFA] rounded transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            id="btn-fullscreen-surface"
            type="button"
            title="Toggle Fullscreen"
            onClick={toggleFullscreen}
            className="p-1.5 hover:bg-[#18181B] hover:text-[#FAFAFA] rounded transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main 3D Canvas */}
      <div className="relative flex-1 w-full h-full min-w-0 min-h-0 overflow-hidden">
        <canvas
          ref={canvasRef}
          id="canvas-brain-3d"
          className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing block"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        />
      </div>

      {/* Hover Info Banner */}
      {hoveredInfo && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-10 px-3 py-1 bg-[#18181B]/95 text-[#38BDF8] border border-[#38BDF8]/40 rounded text-xs font-mono shadow-xl animate-fade-in pointer-events-none">
          {hoveredInfo}
        </div>
      )}

      {/* Bottom Preset Views Toolbar */}
      <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-1 bg-[#09090B]/90 backdrop-blur border border-[#27272A] rounded p-1 text-[11px] text-[#71717A] pointer-events-auto shadow-md overflow-x-auto">
          <span className="px-1 text-[9px] uppercase tracking-wider text-[#71717A] font-bold">Views:</span>
          <button
            type="button"
            onClick={() => setViewPreset('lateral_L')}
            className="px-1.5 py-0.5 bg-[#18181B] hover:bg-[#27272A] text-[#A1A1AA] hover:text-white rounded text-[10px] font-medium transition-colors"
          >
            Lat L
          </button>
          <button
            type="button"
            onClick={() => setViewPreset('medial_L')}
            className="px-1.5 py-0.5 bg-[#18181B] hover:bg-[#27272A] text-[#A1A1AA] hover:text-white rounded text-[10px] font-medium transition-colors"
          >
            Med L
          </button>
          <button
            type="button"
            onClick={() => setViewPreset('lateral_R')}
            className="px-1.5 py-0.5 bg-[#18181B] hover:bg-[#27272A] text-[#A1A1AA] hover:text-white rounded text-[10px] font-medium transition-colors"
          >
            Lat R
          </button>
          <button
            type="button"
            onClick={() => setViewPreset('medial_R')}
            className="px-1.5 py-0.5 bg-[#18181B] hover:bg-[#27272A] text-[#A1A1AA] hover:text-white rounded text-[10px] font-medium transition-colors"
          >
            Med R
          </button>
          <button
            type="button"
            onClick={() => setViewPreset('dorsal')}
            className="px-1.5 py-0.5 bg-[#18181B] hover:bg-[#27272A] text-[#A1A1AA] hover:text-white rounded text-[10px] font-medium transition-colors"
          >
            Dorsal
          </button>
          <button
            type="button"
            onClick={() => setViewPreset('ventral')}
            className="px-1.5 py-0.5 bg-[#18181B] hover:bg-[#27272A] text-[#A1A1AA] hover:text-white rounded text-[10px] font-medium transition-colors"
          >
            Ventral
          </button>
          <button
            type="button"
            onClick={() => setViewPreset('anterior')}
            className="px-1.5 py-0.5 bg-[#18181B] hover:bg-[#27272A] text-[#A1A1AA] hover:text-white rounded text-[10px] font-medium transition-colors"
          >
            Ant
          </button>
          <button
            type="button"
            onClick={() => setViewPreset('posterior')}
            className="px-1.5 py-0.5 bg-[#18181B] hover:bg-[#27272A] text-[#A1A1AA] hover:text-white rounded text-[10px] font-medium transition-colors"
          >
            Post
          </button>
        </div>

        {/* Surface Display Settings Pill */}
        <div className="flex items-center gap-2 bg-[#09090B]/90 backdrop-blur border border-[#27272A] rounded px-2 py-1 text-[11px] text-[#A1A1AA] pointer-events-auto shadow-md">
          <label className="flex items-center gap-1 cursor-pointer">
            <span className="text-[10px] text-[#71717A] uppercase font-bold tracking-wider">Wire:</span>
            <input
              type="checkbox"
              checked={wireframe}
              onChange={(e) => setWireframe(e.target.checked)}
              className="accent-[#38BDF8] rounded cursor-pointer"
            />
          </label>

        </div>
      </div>
    </div>
  );
};
