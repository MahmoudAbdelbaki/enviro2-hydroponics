import * as THREE from 'three';

export class ReservoirRig {
  constructor(spec = {}) {
    this.group = new THREE.Group();
    this.group.name = 'ReservoirRig';

    const maxL = spec?.reservoir?.max_volume_l ?? 120;
    const initialL = spec?.reservoir?.initial_volume_l ?? 100;
    this.maxL = maxL;
    this.currentL = initialL;

    // Physical dimensions in meters for realistic commercial/laboratory hydroponic tank
    this.tankWidth = 0.46;
    this.tankDepth = 0.38;
    this.tankHeight = 0.44;
    this.wallThick = 0.015;

    this.pumpFlowRatio = 1.0;
    this.aeratorRatio = 1.0;
    this.pumpWarning = false;
    this.aeratorWarning = false;

    this.particles = [];
    this.pipeDroplets = [];

    this._buildTank();
    this._buildWater();
    this._buildPump();
    this._buildAerator();
    this._buildGraduations();

    this.setVolume(initialL);
  }

  _buildTank() {
    // Outer translucent frosted HDPE tub
    const outerGeo = new THREE.BoxGeometry(this.tankWidth, this.tankHeight, this.tankDepth);
    const tankMat = new THREE.MeshPhysicalMaterial({
      color: 0xf5f8f6,
      roughness: 0.22,
      transmission: 0.82,
      thickness: 0.04,
      ior: 1.46,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.tankMesh = new THREE.Mesh(outerGeo, tankMat);
    this.tankMesh.position.y = this.tankHeight / 2;
    this.tankMesh.castShadow = true;
    this.tankMesh.receiveShadow = true;
    this.tankMesh.userData = {
      componentId: 'res-1',
      title: 'Main Water Tank',
      type: 'reservoir',
      subtitle: `${this.maxL} L Translucent HDPE Reservoir`,
    };
    this.group.add(this.tankMesh);

    // Subtle brushed rim & support base
    const baseGeo = new THREE.BoxGeometry(this.tankWidth + 0.03, 0.025, this.tankDepth + 0.03);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x425048,
      roughness: 0.5,
      metalness: 0.3,
    });
    const baseMesh = new THREE.Mesh(baseGeo, rimMat);
    baseMesh.position.y = 0.0125;
    baseMesh.receiveShadow = true;
    this.group.add(baseMesh);

    // Top support lip
    const lipGeo = new THREE.BoxGeometry(this.tankWidth + 0.02, 0.02, this.tankDepth + 0.02);
    const lipMesh = new THREE.Mesh(lipGeo, rimMat);
    lipMesh.position.y = this.tankHeight + 0.01;
    this.group.add(lipMesh);
  }

  _buildGraduations() {
    // Volume tick marks on the front face (25%, 50%, 75%, 100%)
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x2e5540,
      transparent: true,
      opacity: 0.45,
      linewidth: 2,
    });

    const fractions = [0.25, 0.5, 0.75, 1.0];
    fractions.forEach((f) => {
      const y = f * (this.tankHeight - 0.05) + 0.02;
      const points = [
        new THREE.Vector3(-this.tankWidth * 0.45, y, this.tankDepth / 2 + 0.001),
        new THREE.Vector3(-this.tankWidth * 0.30, y, this.tankDepth / 2 + 0.001),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, lineMat);
      this.group.add(line);
    });
  }

  _buildWater() {
    // Animated clear crystal aqua water body
    const innerW = this.tankWidth - this.wallThick * 2;
    const innerD = this.tankDepth - this.wallThick * 2;
    const maxWaterH = this.tankHeight - 0.04;

    const waterGeo = new THREE.BoxGeometry(innerW, maxWaterH, innerD, 16, 1, 16);
    this.waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x1692cf,
      roughness: 0.08,
      transmission: 0.88,
      thickness: 0.18,
      ior: 1.333,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });

    this.waterMesh = new THREE.Mesh(waterGeo, this.waterMat);
    this.waterMesh.position.set(0, maxWaterH / 2 + 0.01, 0);
    this.maxWaterHeight = maxWaterH;
    this.waterBaseY = 0.01;
    this.group.add(this.waterMesh);

    // Cache original top vertices for wave ripple animation
    const pos = waterGeo.attributes.position;
    this.topVertexIndices = [];
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > maxWaterH * 0.45) {
        this.topVertexIndices.push(i);
      }
    }
  }

  _buildPump() {
    // Compact industrial submersible centrifugal pump casing
    const pumpGroup = new THREE.Group();
    pumpGroup.position.set(-this.tankWidth * 0.22, 0.05, 0);

    const bodyGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.075, 20);
    const pumpMat = new THREE.MeshStandardMaterial({
      color: 0x1f2723,
      roughness: 0.35,
      metalness: 0.6,
    });
    this.pumpBody = new THREE.Mesh(bodyGeo, pumpMat);
    this.pumpBody.castShadow = true;
    pumpGroup.add(this.pumpBody);

    // Suction suction-cups base
    const suctionGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.012, 20);
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x111613, roughness: 0.8 });
    const suctionMesh = new THREE.Mesh(suctionGeo, rubberMat);
    suctionMesh.position.y = -0.04;
    pumpGroup.add(suctionMesh);

    // Discharge pipe adapter extending upward
    const adapterGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.04, 16);
    const adapterMesh = new THREE.Mesh(adapterGeo, pumpMat);
    adapterMesh.position.set(0.015, 0.05, 0);
    pumpGroup.add(adapterMesh);

    // Warning halo ring (lights up on pump clog / fault)
    const haloGeo = new THREE.RingGeometry(0.065, 0.082, 32);
    this.pumpHaloMat = new THREE.MeshBasicMaterial({
      color: 0xd93829,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
    });
    this.pumpHalo = new THREE.Mesh(haloGeo, this.pumpHaloMat);
    this.pumpHalo.rotation.x = -Math.PI / 2;
    this.pumpHalo.position.y = 0.045;
    pumpGroup.add(this.pumpHalo);

    // Interactive user data for Click-to-Break / Click-to-Inspect
    this.pumpBody.userData = {
      componentId: 'pump-1',
      title: 'Submersible Water Pump',
      type: 'pump',
      subtitle: '3.0 L/min rated continuous duty pump',
      faultId: 'pump',
    };

    this.group.add(pumpGroup);
    this.pumpGroup = pumpGroup;

    // Supply riser pipe adapter emerging through tank lid
    const riserGeo = new THREE.CylinderGeometry(0.012, 0.012, this.tankHeight + 0.04, 16);
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.1,
    });
    this.supplyPipeMesh = new THREE.Mesh(riserGeo, pipeMat);
    this.supplyPipeMesh.position.set(-this.tankWidth * 0.22, (this.tankHeight + 0.04) / 2, 0);
    this.group.add(this.supplyPipeMesh);

    // 90-degree elbow at top of tank
    const elbowGeo = new THREE.SphereGeometry(0.016, 12, 12);
    const elbow = new THREE.Mesh(elbowGeo, pipeMat);
    elbow.position.set(-this.tankWidth * 0.22, this.tankHeight + 0.02, 0);
    this.group.add(elbow);
  }

  _buildAerator() {
    // Sintered porous ceramic air stone sticks at tank bottom
    const aerGroup = new THREE.Group();
    aerGroup.position.set(this.tankWidth * 0.18, 0.025, 0);

    const stoneGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.16, 16);
    stoneGeo.rotateZ(Math.PI / 2);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x607d8b,
      roughness: 0.95,
      metalness: 0.1,
    });

    const stone1 = new THREE.Mesh(stoneGeo, stoneMat);
    stone1.position.z = -0.07;
    stone1.castShadow = true;
    aerGroup.add(stone1);

    const stone2 = new THREE.Mesh(stoneGeo, stoneMat);
    stone2.position.z = 0.07;
    stone2.castShadow = true;
    aerGroup.add(stone2);

    stone1.userData = {
      componentId: 'aer-1',
      title: 'Sintered Air Stones',
      type: 'aerator',
      subtitle: 'Micro-bubble dissolved oxygen infuser',
      faultId: 'aer',
    };
    stone2.userData = stone1.userData;

    this.group.add(aerGroup);
    this.aeratorGroup = aerGroup;

    // Rising micro-bubbles particle pool
    const bubbleGeo = new THREE.SphereGeometry(0.005, 6, 6);
    const bubbleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
    });

    for (let i = 0; i < 36; i++) {
      const b = new THREE.Mesh(bubbleGeo, bubbleMat);
      b.position.set(
        aerGroup.position.x + (Math.random() - 0.5) * 0.14,
        0.03 + Math.random() * (this.tankHeight * 0.7),
        aerGroup.position.z + (Math.random() - 0.5) * 0.22
      );
      b.userData = {
        speed: 0.12 + Math.random() * 0.15,
        drift: (Math.random() - 0.5) * 0.02,
        scale0: 0.5 + Math.random() * 0.8,
      };
      this.particles.push(b);
      this.group.add(b);
    }
  }

  setVolume(liters) {
    this.currentL = Math.max(0, Math.min(liters, this.maxL));
    const ratio = this.currentL / this.maxL;
    const h = Math.max(0.02, ratio * this.maxWaterHeight);

    this.waterMesh.scale.y = Math.max(0.01, h / this.maxWaterHeight);
    this.waterMesh.position.y = this.waterBaseY + h / 2;
  }

  setPumpStatus({ flowRatio = 1.0, isWarning = false }) {
    this.pumpFlowRatio = flowRatio;
    this.pumpWarning = isWarning;
    if (this.pumpHaloMat) {
      this.pumpHaloMat.opacity = isWarning ? 0.75 : 0.0;
    }
  }

  setAeratorStatus({ flowRatio = 1.0, isWarning = false }) {
    this.aeratorRatio = flowRatio;
    this.aeratorWarning = isWarning;
  }

  update(dt, simTimeSec) {
    // 1. Water surface gentle ripple animation
    const pos = this.waterMesh.geometry.attributes.position;
    const waveAmp = 0.002 * (0.3 + 0.7 * this.pumpFlowRatio);
    const waveFreq = 4.0;
    const t = simTimeSec * 1.5;

    for (let idx of this.topVertexIndices) {
      const x = pos.getX(idx);
      const z = pos.getZ(idx);
      const origY = this.maxWaterHeight / 2;
      const ripple = Math.sin(x * 12.0 + t * waveFreq) * Math.cos(z * 12.0 + t * waveFreq) * waveAmp;
      pos.setY(idx, origY + ripple);
    }
    pos.needsUpdate = true;

    // 2. Rising aeration bubbles
    const waterTop = this.waterBaseY + this.waterMesh.scale.y * this.maxWaterHeight;
    const bubbleSpeedMod = this.aeratorRatio;

    this.particles.forEach((b) => {
      if (bubbleSpeedMod < 0.05) {
        b.visible = false;
        return;
      }
      b.visible = true;
      b.position.y += b.userData.speed * bubbleSpeedMod * dt * 2.0;
      b.position.x += b.userData.drift * dt;

      // Pop at water surface and reset to stone
      if (b.position.y >= waterTop) {
        b.position.y = 0.035;
        b.position.x = this.aeratorGroup.position.x + (Math.random() - 0.5) * 0.14;
        b.position.z = this.aeratorGroup.position.z + (Math.random() - 0.5) * 0.2;
      }
    });

    // 3. Flowing water droplets in clear delivery pipe
    if (this.pipeCurve && this.pipeDroplets.length > 0) {
      const pipeSpeed = 0.45 * this.pumpFlowRatio;
      this.pipeDroplets.forEach((d) => {
        if (pipeSpeed <= 0.01) {
          d.visible = false;
          return;
        }
        d.visible = true;
        d.userData.progress = (d.userData.progress + pipeSpeed * dt) % 1.0;
        const pt = this.pipeCurve.getPointAt(d.userData.progress);
        d.position.copy(pt);
      });
    }

    // 4. Warning halo pulse
    if (this.pumpWarning && this.pumpHaloMat) {
      this.pumpHaloMat.opacity = 0.4 + 0.4 * Math.sin(simTimeSec * 6.0);
    }
  }
}
