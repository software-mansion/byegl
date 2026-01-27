import * as THREE from 'three';
import {
  klein,
  mobius,
  plane,
} from 'three/addons/geometries/ParametricFunctions.js';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';

import type { ExampleContext } from '../../types.ts';

export default function ({ canvas }: ExampleContext) {
  const aspectRatio = window.innerWidth / window.innerHeight;
  const camera = new THREE.PerspectiveCamera(45, aspectRatio, 1, 2000);
  camera.position.y = 500;

  const scene = new THREE.Scene();

  const ambientLight = new THREE.AmbientLight(0xcccccc, 1.5);
  scene.add(ambientLight);

  const pointLight = new THREE.PointLight(0xffffff, 2.5, 0, 0);
  camera.add(pointLight);
  scene.add(camera);

  const map = new THREE.TextureLoader().load(
    'https://raw.githubusercontent.com/mrdoob/three.js/refs/heads/master/examples/textures/uv_grid_opengl.jpg',
  );
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 16;
  map.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshPhongMaterial({
    map: map,
    side: THREE.DoubleSide,
  });

  {
    const object = new THREE.Mesh(
      new THREE.SphereGeometry(75, 20, 10),
      material,
    );
    object.position.set(-300, 0, 300);
    scene.add(object);
  }

  {
    const object = new THREE.Mesh(new THREE.IcosahedronGeometry(75), material);
    object.position.set(-100, 0, 300);
    scene.add(object);
  }

  {
    const object = new THREE.Mesh(new THREE.OctahedronGeometry(75), material);
    object.position.set(100, 0, 300);
    scene.add(object);
  }

  {
    const object = new THREE.Mesh(new THREE.TetrahedronGeometry(75), material);
    object.position.set(300, 0, 300);
    scene.add(object);
  }

  {
    const object = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100, 4, 4),
      material,
    );
    object.position.set(-300, 0, 100);
    scene.add(object);
  }

  {
    const object = new THREE.Mesh(
      new THREE.BoxGeometry(100, 100, 100, 4, 4, 4),
      material,
    );
    object.position.set(-100, 0, 100);
    scene.add(object);
  }

  {
    const object = new THREE.Mesh(
      new THREE.CircleGeometry(50, 20, 0, Math.PI * 2),
      material,
    );
    object.position.set(100, 0, 100);
    scene.add(object);
  }

  {
    const object = new THREE.Mesh(
      new THREE.RingGeometry(10, 50, 20, 5, 0, Math.PI * 2),
      material,
    );
    object.position.set(300, 0, 100);
    scene.add(object);
  }

  {
    const object = new THREE.Mesh(
      new THREE.CylinderGeometry(25, 75, 100, 40, 5),
      material,
    );
    object.position.set(-300, 0, -100);
    scene.add(object);
  }

  const points: THREE.Vector2[] = [];

  for (let i = 0; i < 50; i++) {
    points.push(
      new THREE.Vector2(
        Math.sin(i * 0.2) * Math.sin(i * 0.1) * 15 + 50,
        (i - 5) * 2,
      ),
    );
  }

  {
    const object = new THREE.Mesh(
      new THREE.LatheGeometry(points, 20),
      material,
    );
    object.position.set(-100, 0, -100);
    scene.add(object);
  }

  {
    const object = new THREE.Mesh(
      new THREE.TorusGeometry(50, 20, 20, 20),
      material,
    );
    object.position.set(100, 0, -100);
    scene.add(object);
  }

  {
    const object = new THREE.Mesh(
      new THREE.TorusKnotGeometry(50, 10, 50, 20),
      material,
    );
    object.position.set(300, 0, -100);
    scene.add(object);
  }

  //
  {
    const object = new THREE.Mesh(new THREE.CapsuleGeometry(20, 50), material);
    object.position.set(-300, 0, -300);
    scene.add(object);
  }

  {
    const geometry = new ParametricGeometry(plane, 10, 10);
    geometry.scale(100, 100, 100);
    geometry.center();
    const object = new THREE.Mesh(geometry, material);
    object.position.set(-100, 0, -300);
    scene.add(object);
  }

  {
    const geometry = new ParametricGeometry(klein, 20, 20);
    const object = new THREE.Mesh(geometry, material);
    object.position.set(100, 0, -300);
    object.scale.multiplyScalar(5);
    scene.add(object);
  }

  {
    const geometry = new ParametricGeometry(mobius, 20, 20);
    const object = new THREE.Mesh(geometry, material);
    object.position.set(300, 0, -300);
    object.scale.multiplyScalar(30);
    scene.add(object);
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setAnimationLoop(animate);

  function animate() {
    const timer = Date.now() * 0.0001;

    camera.position.x = Math.cos(timer) * 800;
    camera.position.z = Math.sin(timer) * 800;

    camera.lookAt(scene.position);

    scene.traverse((object) => {
      if ((object as any).isMesh === true) {
        object.rotation.x = timer * 5;
        object.rotation.y = timer * 2.5;
      }
    });

    renderer.render(scene, camera);
  }

  return () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
  };
}
