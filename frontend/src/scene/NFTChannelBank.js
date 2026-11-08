import * as THREE from 'three';

export class NFTChannelBank {
  constructor(spec = {}) {
    this.group = new THREE.Group();
    this.group.name = 'NFTChannelBank';

    const ch = spec?.channels ?? {};
    this.channelCount = Math.max(3, ch.count ?? 4); // At least 3-4 parallel gullies per bench
    this.channelLength = Math.max(1.6, ch.length ?? 1.8);
    this.channelWidth = ch.width ?? 0.12;
    this.channelDepth = 0.06;
    this.channelSlope = ch.slope ?? 0.02; // 2% tilt
    this.plantsPerChannel = Math.max(6, ch.plants_per_channel ?? ch.plantsPerChannel ?? 7);

    this.channelSpacing = 0.18;
    this.tableHeight = 0.64;

    this.plantPortPositions = []; // World coords for planting ports
    this.waterMeshes = [];

    // Commercial greenhouse layout: 3 parallel bays (Left Bay, Center Active Twin, Right Bay)
    this.bayOffsets = [-1.30, 0.0, 1.30]; // X offsets for 3 multi-row growing tables

    this._buildCommercialFacility();
  }

  _buildCommercialFacility() {
    this.bayOffsets.forEach((bayX, bayIdx) => {
      const isActiveTwin = bayIdx === 1; // Center bench is the active instrumented twin
      this._buildBenchTable(bayIdx, bayX, isActiveTwin, `Bay ${String.fromCharCode(65 + bayIdx)}`);
    });
  }

  _buildBenchTable(bayIdx, bayX, isActiveTwin, bayLabel) {
    const tableGroup = new THREE.Group();
    tableGroup.position.set(bayX, 0, 0);

    const tableWidth = (this.channelCount - 1) * this.channelSpacing + this.channelWidth + 0.10;
    const tableLen = this.channelLength + 0.08;

    // 1. Brushed Aluminum 4040 Commercial Stand Frame
    const standMat = new THREE.MeshStandardMaterial({
      color: isActiveTwin ? 0xf0f4f8 : 0xdde4ea,
      roughness: 0.32,
      metalness: 0.2,
    });

    const legX = tableWidth / 2 - 0.02;
    const legZ = tableLen / 2 - 0.04;

    // 6 Vertical legs per long bench (front, mid, rear)
    const legGeo = new THREE.BoxGeometry(0.035, this.tableHeight, 0.035);
    const footGeo = new THREE.CylinderGeometry(0.024, 0.026, 0.014, 12);
    const footMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.8 });

    [-legX, legX].forEach((x) => {
      [-legZ, 0, legZ].forEach((z) => {
        const leg = new THREE.Mesh(legGeo, standMat);
        leg.position.set(x, this.tableHeight / 2, z);
        leg.castShadow = true;
        leg.receiveShadow = true;
        tableGroup.add(leg);

        const foot = new THREE.Mesh(footGeo, footMat);
        foot.position.set(x, 0.007, z);
        tableGroup.add(foot);
      });
    });

    // Horizontal longitudinal structural rails
    const longRailGeo = new THREE.BoxGeometry(0.03, 0.03, tableLen);
    [-legX, legX].forEach((x) => {
      const railLow = new THREE.Mesh(longRailGeo, standMat);
      railLow.position.set(x, 0.14, 0);
      tableGroup.add(railLow);

      const railHigh = new THREE.Mesh(longRailGeo, standMat);
      railHigh.position.set(x, this.tableHeight - 0.015, 0);
      tableGroup.add(railHigh);
    });

    // Cross-bracing beams
    const crossBeamGeo = new THREE.BoxGeometry(tableWidth, 0.03, 0.03);
    [-legZ, 0, legZ].forEach((z) => {
      const beam = new THREE.Mesh(crossBeamGeo, standMat);
      beam.position.set(0, this.tableHeight - 0.015, z);
      tableGroup.add(beam);
    });

    // 2. Parallel White NFT Gullies on Sloped Sub-Frame
    const slopeAngle = Math.atan(this.channelSlope);
    const totalSpan = (this.channelCount - 1) * this.channelSpacing;
    const startX = -totalSpan / 2;

    const gullyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.16,
      metalness: 0.04,
    });

    const portSpacing = this.channelLength / (this.plantsPerChannel + 1);
    const portRadius = 0.026;

    for (let c = 0; c < this.channelCount; c++) {
      const gullyX = startX + c * this.channelSpacing;
      const gully = new THREE.Group();
      gully.position.set(gullyX, this.tableHeight + 0.02, 0);
      gully.rotation.x = slopeAngle;

      // Gully bottom
      const bottomGeo = new THREE.BoxGeometry(this.channelWidth, 0.006, this.channelLength);
      const bottom = new THREE.Mesh(bottomGeo, gullyMat);
      bottom.position.y = 0.003;
      bottom.receiveShadow = true;
      gully.add(bottom);

      // Gully sides
      const sideGeo = new THREE.BoxGeometry(0.006, this.channelDepth, this.channelLength);
      const leftSide = new THREE.Mesh(sideGeo, gullyMat);
      leftSide.position.set(-this.channelWidth / 2 + 0.003, this.channelDepth / 2, 0);
      gully.add(leftSide);

      // On active center twin, outer gully gets transparent X-ray side window
      let rightSideMat = gullyMat;
      if (isActiveTwin && c === this.channelCount - 1) {
        rightSideMat = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.12,
          transmission: 0.88,
          thickness: 0.02,
          transparent: true,
          opacity: 0.72,
        });
      }
      const rightSide = new THREE.Mesh(sideGeo, rightSideMat);
      rightSide.position.set(this.channelWidth / 2 - 0.003, this.channelDepth / 2, 0);
      gully.add(rightSide);

      // Top cover with planting ports
      const topCover = new THREE.Group();
      const collarMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.5 });
      const collarGeo = new THREE.RingGeometry(portRadius, portRadius + 0.005, 20);
      collarGeo.rotateX(-Math.PI / 2);

      for (let p = 1; p <= this.plantsPerChannel; p++) {
        const portZ = -this.channelLength / 2 + p * portSpacing;
        const collar = new THREE.Mesh(collarGeo, collarMat);
        collar.position.set(0, this.channelDepth + 0.004, portZ);
        topCover.add(collar);

        // Calculate world coordinates for crop instancer
        const yCollar = this.channelDepth + 0.004;
        const worldPos = new THREE.Vector3(
          bayX + gullyX,
          this.tableHeight + 0.02 + yCollar * Math.cos(slopeAngle) - portZ * Math.sin(slopeAngle),
          yCollar * Math.sin(slopeAngle) + portZ * Math.cos(slopeAngle)
        );

        this.plantPortPositions.push({
          bayIndex: bayIdx,
          channelIndex: c,
          plantIndex: p - 1,
          isActiveTwin,
          position: worldPos,
          gullyRotation: slopeAngle,
        });
      }

      const topLidGeo = new THREE.BoxGeometry(this.channelWidth, 0.005, this.channelLength);
      const topLid = new THREE.Mesh(topLidGeo, gullyMat);
      topLid.position.y = this.channelDepth + 0.0025;
      topCover.add(topLid);
      gully.add(topCover);

      // End caps
      const endCapGeo = new THREE.BoxGeometry(this.channelWidth + 0.002, this.channelDepth + 0.002, 0.008);
      const inletCap = new THREE.Mesh(endCapGeo, gullyMat);
      inletCap.position.set(0, this.channelDepth / 2, -this.channelLength / 2);
      gully.add(inletCap);

      // Thin-film nutrient water stream inside each gully
      const filmGeo = new THREE.PlaneGeometry(this.channelWidth - 0.016, this.channelLength - 0.02, 1, 16);
      filmGeo.rotateX(-Math.PI / 2);

      const count = filmGeo.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = 0.16;
        colors[i * 3 + 1] = 0.71;
        colors[i * 3 + 2] = 0.96;
      }
      filmGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const filmMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.08,
        metalness: 0.1,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      });

      const waterFilm = new THREE.Mesh(filmGeo, filmMat);
      waterFilm.position.set(0, 0.014, 0);
      gully.add(waterFilm);
      this.waterMeshes.push(waterFilm);

      if (isActiveTwin) {
        gully.userData = {
          componentId: `ch-${c + 1}`,
          title: `NFT Gully Channel #${c + 1}`,
          type: 'channel',
          subtitle: `Active Digital Twin Gully (${this.plantsPerChannel} Batavia heads)`,
        };
      }

      tableGroup.add(gully);
    }

    // 3. Drainage Collector Manifold at Low End
    const lowZ = (this.channelLength / 2) * Math.cos(slopeAngle) + 0.02;
    const lowY = this.tableHeight + 0.02 - (this.channelLength / 2) * Math.sin(slopeAngle);

    const pipeGeo = new THREE.CylinderGeometry(0.018, 0.018, totalSpan + 0.14, 16);
    pipeGeo.rotateZ(Math.PI / 2);
    const pvcMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f5, roughness: 0.25 });

    const collectorPipe = new THREE.Mesh(pipeGeo, pvcMat);
    collectorPipe.position.set(0, lowY, lowZ);
    collectorPipe.castShadow = true;
    tableGroup.add(collectorPipe);

    // Downward discharge drop spout
    const dropGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.07, 16);
    const dropSpout = new THREE.Mesh(dropGeo, pvcMat);
    dropSpout.position.set(0, lowY - 0.035, lowZ);
    dropSpout.castShadow = true;
    tableGroup.add(dropSpout);

    // Tag table
    tableGroup.userData = {
      componentId: isActiveTwin ? 'channels' : `bench-${bayIdx}`,
      title: `${bayLabel} NFT Hydroponic Table`,
      type: 'channel_bank',
      subtitle: `${this.channelCount} sloped UPVC gullies · ${this.channelCount * this.plantsPerChannel} Batavia rosettes`,
    };

    this.group.add(tableGroup);
  }

  setDissolvedOxygen({ inletDO = 8.0, outletDO = 7.6, flowRate = 3.0 }) {
    const doOutletNorm = Math.max(0.0, Math.min(1.0, (outletDO - 3.0) / 4.5));

    const rOut = 0.94 * (1.0 - doOutletNorm) + 0.16 * doOutletNorm;
    const gOut = 0.33 * (1.0 - doOutletNorm) + 0.71 * doOutletNorm;
    const bOut = 0.31 * (1.0 - doOutletNorm) + 0.96 * doOutletNorm;

    this.waterMeshes.forEach((mesh) => {
      const colors = mesh.geometry.attributes.color;
      const count = colors.count;
      for (let i = 0; i < count; i++) {
        const tZ = i / count;
        const r = 0.16 * (1.0 - tZ) + rOut * tZ;
        const g = 0.71 * (1.0 - tZ) + gOut * tZ;
        const b = 0.96 * (1.0 - tZ) + bOut * tZ;
        colors.setXYZ(i, r, g, b);
      }
      colors.needsUpdate = true;
    });
  }

  update(dt, simTimeSec) {
    const shimmer = 0.82 + 0.08 * Math.sin(simTimeSec * 4.0);
    this.waterMeshes.forEach((m) => {
      m.material.opacity = shimmer;
    });
  }
}
