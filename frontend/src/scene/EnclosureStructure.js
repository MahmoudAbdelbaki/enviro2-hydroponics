import * as THREE from 'three';

export class EnclosureStructure {
  constructor(spec = {}) {
    this.group = new THREE.Group();
    this.group.name = 'EnclosureStructure';

    const enc = spec?.enclosure ?? {};
    this.enclosureType = enc.type ?? 'greenhouse';
    this.fanThrottle = 1.0;
    this.fans = [];

    this._buildStudioFloor();
    this._buildGreenhouseFraming();
    this._buildGrowLights();
    this._buildFans();
  }

  _buildStudioFloor() {
    // 1. Polished clean alabaster epoxy greenhouse floor plane (#F5F6F2)
    const floorGeo = new THREE.PlaneGeometry(10.0, 10.0);
    floorGeo.rotateX(-Math.PI / 2);

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xf5f6f2,
      roughness: 0.92,
      metalness: 0.02,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.y = -0.002;
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);

    // Subtle greenhouse floor grid
    const grid = new THREE.GridHelper(8.0, 32, 0xd4ded5, 0xe4ebe4);
    grid.position.y = 0.001;
    this.group.add(grid);

    // 2. Walkway aisle runners between bays (clean light sage/grey epoxy pathways)
    const aisleMat = new THREE.MeshBasicMaterial({
      color: 0xe8ede8,
      transparent: true,
      opacity: 0.65,
    });
    [-0.65, 0.65].forEach((x) => {
      const runnerGeo = new THREE.PlaneGeometry(0.52, 3.2);
      runnerGeo.rotateX(-Math.PI / 2);
      const runner = new THREE.Mesh(runnerGeo, aisleMat);
      runner.position.set(x, 0.002, 0);
      this.group.add(runner);
    });

    // 3. Commercial stainless floor drainage grating channel along front discharge manifold
    const trenchGeo = new THREE.BoxGeometry(4.2, 0.012, 0.16);
    const trenchMat = new THREE.MeshStandardMaterial({
      color: 0xcfd8dc,
      roughness: 0.45,
      metalness: 0.4,
    });
    const trench = new THREE.Mesh(trenchGeo, trenchMat);
    trench.position.set(0, 0.006, 1.05);
    trench.receiveShadow = true;
    this.group.add(trench);

    // Grate slot stripes
    const slotMat = new THREE.MeshBasicMaterial({ color: 0x90a4ae });
    for (let x = -2.0; x <= 2.0; x += 0.08) {
      const slotGeo = new THREE.BoxGeometry(0.016, 0.002, 0.12);
      const slot = new THREE.Mesh(slotGeo, slotMat);
      slot.position.set(x, 0.013, 1.05);
      this.group.add(slot);
    }
  }

  _buildGreenhouseFraming() {
    // Architectural Dutch Venlo-style greenhouse structural framing
    // Positioned at the rear and overhead to maintain 100% open viewing from front and sides!
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.28,
      metalness: 0.12,
    });

    const rearZ = -1.05;
    const postHeight = 1.95;
    const postXCoords = [-1.95, -0.65, 0.65, 1.95];

    // 4 Vertical rear galvanized structural columns
    postXCoords.forEach((x) => {
      const postGeo = new THREE.BoxGeometry(0.045, postHeight, 0.045);
      const post = new THREE.Mesh(postGeo, frameMat);
      post.position.set(x, postHeight / 2, rearZ);
      post.castShadow = true;
      post.receiveShadow = true;
      this.group.add(post);
    });

    // Horizontal gutter beam connecting the column tops
    const gutterBeamGeo = new THREE.BoxGeometry(4.1, 0.05, 0.05);
    const gutterBeam = new THREE.Mesh(gutterBeamGeo, frameMat);
    gutterBeam.position.set(0, postHeight, rearZ);
    gutterBeam.castShadow = true;
    this.group.add(gutterBeam);

    // Intermediate horizontal stiffener rail
    const midRailGeo = new THREE.BoxGeometry(4.0, 0.035, 0.035);
    const midRail = new THREE.Mesh(midRailGeo, frameMat);
    midRail.position.set(0, postHeight * 0.48, rearZ);
    this.group.add(midRail);

    // Peaked Venlo roof truss rafters overhead (2 dual-pitch gables spanning the 3 bays)
    const peakHeight = postHeight + 0.50; // 2.45m high roof ridge
    const gableCenters = [-1.0, 1.0];

    gableCenters.forEach((gx) => {
      // Left rafter
      const rafterGeo = new THREE.BoxGeometry(1.15, 0.035, 0.035);
      const leftRafter = new THREE.Mesh(rafterGeo, frameMat);
      leftRafter.position.set(gx - 0.48, postHeight + 0.25, rearZ);
      leftRafter.rotation.z = Math.atan2(0.50, 0.95);
      leftRafter.castShadow = true;
      this.group.add(leftRafter);

      // Right rafter
      const rightRafter = new THREE.Mesh(rafterGeo, frameMat);
      rightRafter.position.set(gx + 0.48, postHeight + 0.25, rearZ);
      rightRafter.rotation.z = -Math.atan2(0.50, 0.95);
      rightRafter.castShadow = true;
      this.group.add(rightRafter);

      // Vertical king post
      const kingGeo = new THREE.BoxGeometry(0.035, 0.50, 0.035);
      const kingPost = new THREE.Mesh(kingGeo, frameMat);
      kingPost.position.set(gx, postHeight + 0.25, rearZ);
      this.group.add(kingPost);
    });

    // Frosted architectural polycarbonate wall panels at rear
    const wallPanelGeo = new THREE.PlaneGeometry(3.9, postHeight - 0.1);
    const glazeMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.90,
      roughness: 0.22,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const rearWall = new THREE.Mesh(wallPanelGeo, glazeMat);
    rearWall.position.set(0, postHeight / 2, rearZ);
    this.group.add(rearWall);

    rearWall.userData = {
      componentId: 'enc-1',
      title: 'Greenhouse Enclosure',
      type: 'enclosure',
      subtitle: 'Commercial CEA Dutch-Venlo polycarbonate greenhouse',
      faultId: 'heat',
    };
  }

  _buildGrowLights() {
    // Commercial horticultural LED luminaires suspended above EACH bay (Bay A, Bay B, Bay C)
    const bayXOffsets = [-1.30, 0.0, 1.30];

    const fixtureMat = new THREE.MeshStandardMaterial({
      color: 0xdce2e6,
      roughness: 0.25,
      metalness: 0.75,
    });

    const emitterMat = new THREE.MeshBasicMaterial({
      color: 0xfff6dc, // Full spectrum warm horticultural sunlight LED glow
    });

    bayXOffsets.forEach((bayX) => {
      const lightGroup = new THREE.Group();
      lightGroup.position.set(bayX, 1.30, 0); // Positioned centered above each bench

      // 2 Parallel slim aluminum LED bars per bay
      [-0.14, 0.14].forEach((x) => {
        const barGeo = new THREE.BoxGeometry(0.032, 0.016, 1.62);
        const bar = new THREE.Mesh(barGeo, fixtureMat);
        bar.position.set(x, 0, 0);
        bar.castShadow = true;
        lightGroup.add(bar);

        // Underside luminous emissive LED strip
        const emitterGeo = new THREE.BoxGeometry(0.022, 0.003, 1.58);
        const emitter = new THREE.Mesh(emitterGeo, emitterMat);
        emitter.position.set(x, -0.008, 0);
        lightGroup.add(emitter);
      });

      // Structural cross-brackets
      const bracketGeo = new THREE.BoxGeometry(0.36, 0.015, 0.024);
      [-0.55, 0.55].forEach((z) => {
        const bracket = new THREE.Mesh(bracketGeo, fixtureMat);
        bracket.position.set(0, 0.014, z);
        lightGroup.add(bracket);
      });

      // Slim suspension wires from overhead roof frame
      const wireMat = new THREE.MeshBasicMaterial({ color: 0xb0bec5 });
      const wireGeo = new THREE.CylinderGeometry(0.0015, 0.0015, 0.55, 6);
      [-0.55, 0.55].forEach((z) => {
        const wire = new THREE.Mesh(wireGeo, wireMat);
        wire.position.set(0, 0.28, z);
        lightGroup.add(wire);
      });

      this.group.add(lightGroup);
    });
  }

  _buildFans() {
    // 2 Commercial horizontal airflow (HAF) circulation fans mounted on rear framing
    [-0.85, 0.85].forEach((fanX, idx) => {
      const fanGroup = new THREE.Group();
      fanGroup.position.set(fanX, 1.40, -1.02);

      // Shroud ring
      const shroudGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.032, 22, 1, true);
      shroudGeo.rotateX(Math.PI / 2);
      const shroudMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.4 });
      const shroud = new THREE.Mesh(shroudGeo, shroudMat);
      shroud.castShadow = true;
      fanGroup.add(shroud);

      // Center motor hub
      const hubGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.034, 14);
      hubGeo.rotateX(Math.PI / 2);
      const hubMat = new THREE.MeshStandardMaterial({ color: 0x1a2421, metalness: 0.8, roughness: 0.3 });
      const hub = new THREE.Mesh(hubGeo, hubMat);
      fanGroup.add(hub);

      // Rotor blades
      const rotor = new THREE.Group();
      const bladeGeo = new THREE.BoxGeometry(0.016, 0.058, 0.003);
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.3 });

      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.y = 0.038;
        blade.rotation.x = 0.25;

        const bladePivot = new THREE.Group();
        bladePivot.rotation.z = (i / 3) * Math.PI * 2;
        bladePivot.add(blade);
        rotor.add(bladePivot);
      }
      fanGroup.add(rotor);
      this.fans.push(rotor);

      if (idx === 0) {
        fanGroup.userData = {
          componentId: 'fans-1',
          title: 'Canopy Circulation Fans (HAF)',
          type: 'fan',
          subtitle: 'Horizontal air circulation for canopy transpiration & VPD control',
        };
      }

      this.group.add(fanGroup);
    });
  }

  setFanThrottle(throttle = 1.0) {
    this.fanThrottle = throttle;
  }

  update(dt, simTimeSec) {
    if (this.fans.length > 0 && this.fanThrottle > 0.01) {
      const speed = dt * (8.5 * this.fanThrottle);
      this.fans.forEach((r) => {
        r.rotation.z -= speed;
      });
    }
  }
}
