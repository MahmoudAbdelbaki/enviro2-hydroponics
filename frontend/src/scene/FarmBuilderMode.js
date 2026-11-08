import * as THREE from 'three';

export class FarmBuilderMode {
  constructor({ scene, camera, renderer, api, onValidationUpdate, onLayoutChange }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.api = api;
    this.onValidationUpdate = onValidationUpdate;
    this.onLayoutChange = onLayoutChange;

    this.active = false;
    this.selectedObject = null;
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.planeIntersect = new THREE.Vector3();
    this.isDragging = false;
    this.dragOffset = new THREE.Vector3();

    this.validationTimer = null;
    this.validationResult = { valid: true, issues: [] };

    this.pipeGroup = new THREE.Group();
    this.pipeGroup.name = 'AutoRoutedPipes';
    this.scene.add(this.pipeGroup);

    this._setupEvents();
  }

  _setupEvents() {
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  attachComponents({ reservoirRig, channelBank, dosingSkid, currentSpec }) {
    this.reservoirRig = reservoirRig;
    this.channelBank = channelBank;
    this.dosingSkid = dosingSkid;
    this.currentSpec = JSON.parse(JSON.stringify(currentSpec));

    this.draggableRigs = [
      { id: 'res-1', group: reservoirRig.group, name: 'Water Reservoir', type: 'reservoir' },
      { id: 'channels', group: channelBank.group, name: 'NFT Gully Table', type: 'channels' },
      { id: 'skid', group: dosingSkid.group, name: 'AI Dosing Skid', type: 'dosing' },
    ];

    this.rebuildDynamicPlumbing();
  }

  activate() {
    this.active = true;
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    this.rebuildDynamicPlumbing();
    this.validateCurrentLayout();
  }

  deactivate() {
    this.active = false;
    this.isDragging = false;
    this.selectedObject = null;
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
  }

  _onPointerDown(e) {
    if (!this.active) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = [];
    this.draggableRigs.forEach((rig) => {
      rig.group.traverse((child) => {
        if (child.isMesh) {
          child.userData.rigRef = rig;
          meshes.push(child);
        }
      });
    });

    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const rig = hits[0].object.userData.rigRef;
      if (rig) {
        this.selectedObject = rig;
        this.isDragging = true;
        if (this.raycaster.ray.intersectPlane(this.dragPlane, this.planeIntersect)) {
          this.dragOffset.copy(rig.group.position).sub(this.planeIntersect);
        }
        if (this.onLayoutChange) this.onLayoutChange('select', rig);
      }
    }
  }

  _onPointerMove(e) {
    if (!this.active || !this.isDragging || !this.selectedObject) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.planeIntersect)) {
      const newX = this.planeIntersect.x + this.dragOffset.x;
      const newZ = this.planeIntersect.z + this.dragOffset.z;

      // Snap to 5cm grid
      const snappedX = Math.round(newX * 20) / 20;
      const snappedZ = Math.round(newZ * 20) / 20;

      this.selectedObject.group.position.x = snappedX;
      this.selectedObject.group.position.z = snappedZ;

      this.rebuildDynamicPlumbing();
      this._scheduleValidation();
    }
  }

  _onPointerUp() {
    if (this.isDragging) {
      this.isDragging = false;
      this.rebuildDynamicPlumbing();
      this._scheduleValidation();
    }
  }

  rebuildDynamicPlumbing() {
    if (!this.reservoirRig || !this.channelBank) return;

    // Clear old plumbing
    while (this.pipeGroup.children.length > 0) {
      const obj = this.pipeGroup.children[0];
      this.pipeGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }

    const resPos = this.reservoirRig.group.position;
    const chPos = this.channelBank.group.position;

    const pvcMat = new THREE.MeshStandardMaterial({
      color: 0xf0f4f1,
      roughness: 0.25,
      metalness: 0.05,
    });

    // 1. Supply Line: Clean pipe from pump riser along table underside to inlet header
    const supplyPoints = [
      new THREE.Vector3(resPos.x - 0.10, 0.42, resPos.z),
      new THREE.Vector3(resPos.x - 0.10, 0.65, resPos.z),
      new THREE.Vector3(chPos.x - 0.20, 0.65, resPos.z),
      new THREE.Vector3(chPos.x - 0.20, 0.65, chPos.z - 0.70),
      new THREE.Vector3(chPos.x, 0.68, chPos.z - 0.75),
    ];
    const supplyCurve = new THREE.CatmullRomCurve3(supplyPoints, false, 'catmullrom', 0.15);
    const supplyGeo = new THREE.TubeGeometry(supplyCurve, 32, 0.011, 10, false);
    const supplyMesh = new THREE.Mesh(supplyGeo, pvcMat);
    supplyMesh.castShadow = true;
    this.pipeGroup.add(supplyMesh);

    // 2. Return Drain Line: Clean drop directly under gullies into reservoir
    const drainPoints = [
      new THREE.Vector3(chPos.x, 0.58, chPos.z + 0.82),
      new THREE.Vector3(chPos.x, 0.44, chPos.z + 0.82),
      new THREE.Vector3(resPos.x + 0.10, 0.44, 0.50),
      new THREE.Vector3(resPos.x + 0.10, 0.44, resPos.z + 0.10),
      new THREE.Vector3(resPos.x + 0.10, 0.42, resPos.z + 0.05),
    ];
    const drainCurve = new THREE.CatmullRomCurve3(drainPoints, false, 'catmullrom', 0.15);
    const drainGeo = new THREE.TubeGeometry(drainCurve, 32, 0.013, 10, false);
    const drainMesh = new THREE.Mesh(drainGeo, pvcMat);
    drainMesh.castShadow = true;
    this.pipeGroup.add(drainMesh);
  }

  _scheduleValidation() {
    clearTimeout(this.validationTimer);
    this.validationTimer = setTimeout(() => {
      this.validateCurrentLayout();
    }, 250);
  }

  async validateCurrentLayout() {
    if (!this.api || !this.currentSpec) return;

    try {
      const res = await this.api.validateFarm(this.currentSpec);
      this.validationResult = res;
      if (this.onValidationUpdate) {
        this.onValidationUpdate(res);
      }
    } catch (err) {
      console.warn('Layout validation call failed:', err);
    }
  }

  updateParam(category, key, value) {
    if (!this.currentSpec) return;
    if (this.currentSpec[category]) {
      this.currentSpec[category][key] = value;
    }
    this._scheduleValidation();
  }
}
