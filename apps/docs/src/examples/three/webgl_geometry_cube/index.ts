import * as THREE from 'three';
import type { ExampleContext } from '../../types.ts';

export default function ({ canvas }: ExampleContext) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    70,
    canvas.width / canvas.height,
    0.1,
    100,
  );
  camera.position.z = 2;

  const texture = new THREE.TextureLoader().load(
    'https://raw.githubusercontent.com/mrdoob/three.js/refs/heads/master/examples/textures/crate.gif',
  );
  texture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.BoxGeometry();
  // TODO: Fix texture bug in order to show the crate texture
  const material = new THREE.MeshBasicMaterial({ color: 0xff0055 });

  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.width, canvas.height);

  function animate() {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(animate);

  return () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
  };
}
