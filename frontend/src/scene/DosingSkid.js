import * as THREE from 'three';

export class DosingSkid {
  constructor(options = {}) {
    this.group = new THREE.Group();
    this.group.name = 'DosingSkid';

    this.bottles = {};
    this.tubes = [];
    this.droplets = [];
    this.rotors = [];
    this.activeDoses = []; // [{ bottleKey, timer, maxDuration }]

    this._buildSkid();
    this._buildBottles();
    this._buildPeristalticHeads();
    this._buildTubing();
  }

  _buildSkid() {
    // Laboratory poly tray skid base
    const skidGeo = new THREE.BoxGeometry(0.36, 0.02, 0.28);
    const skidMat = new THREE.MeshStandardMaterial({
      color: 0xe0e5e2,
      roughness: 0.4,
      metalness: 0.1,
    });
    const skidMesh = new THREE.Mesh(skidGeo, skidMat);
    skidMesh.position.y = 0.01;
    skidMesh.receiveShadow = true;
    this.group.add(skidMesh);

    // Subtle raised boundary lip
    const lipGeo = new THREE.BoxGeometry(0.37, 0.035, 0.29);
    const wireMat = new THREE.MeshStandardMaterial({
      color: 0x90a4ae,
      roughness: 0.3,
      metalness: 0.5,
      wireframe: false,
    });
    // Inner cutout visual: just side rims
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb0bec5, roughness: 0.4 });
    const rimFront = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.03, 0.01), rimMat);
    rimFront.position.set(0, 0.015, 0.14);
    this.group.add(rimFront);
  }

  _buildBottles() {
    // 4 standard 1000 mL laboratory reagent bottles
    const BOTTLE_DEFS = [
      {
        key: 'stock-a',
        name: 'Stock A (Macro Cations)',
        chem: 'Ca(NO₃)₂ + KNO₃ + Fe-DTPA',
        color: 0x2e7d32, // Emerald
        liquidColor: 0x43a047,
        x: -0.12,
        z: -0.05,
        faultId: 'mix',
      },
      {
        key: 'stock-b',
        name: 'Stock B (Macro Anions)',
        chem: 'KH₂PO₄ + MgSO₄ + Micronutrients',
        color: 0x1976d2, // Sapphire
        liquidColor: 0x29b6f6,
        x: -0.04,
        z: -0.05,
      },
      {
        key: 'stock-acid',
        name: 'pH Down (1M Nitric Acid)',
        chem: '1M HNO₃',
        color: 0xe65100, // Amber orange
        liquidColor: 0xff9800,
        x: 0.04,
        z: -0.05,
      },
      {
        key: 'stock-base',
        name: 'pH Up (1M Potassium Hydroxide)',
        chem: '1M KOH',
        color: 0x7b1fa2, // Purple
        liquidColor: 0xba68c8,
        x: 0.12,
        z: -0.05,
      },
    ];

    const bottleRadius = 0.032;
    const bottleHeight = 0.11;

    BOTTLE_DEFS.forEach((b) => {
      const bGroup = new THREE.Group();
      bGroup.position.set(b.x, 0.02, b.z);

      // Translucent laboratory glass bottle
      const glassGeo = new THREE.CylinderGeometry(bottleRadius, bottleRadius, bottleHeight, 20);
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.12,
        transmission: 0.85,
        thickness: 0.015,
        transparent: true,
        opacity: 0.75,
      });
      const bottleMesh = new THREE.Mesh(glassGeo, glassMat);
      bottleMesh.position.y = bottleHeight / 2;
      bottleMesh.castShadow = true;
      bGroup.add(bottleMesh);

      // Liquid volume inside (80% full)
      const liquidGeo = new THREE.CylinderGeometry(bottleRadius - 0.003, bottleRadius - 0.003, bottleHeight * 0.75, 16);
      const liquidMat = new THREE.MeshStandardMaterial({
        color: b.liquidColor,
        roughness: 0.2,
        transparent: true,
        opacity: 0.82,
      });
      const liquidMesh = new THREE.Mesh(liquidGeo, liquidMat);
      liquidMesh.position.y = (bottleHeight * 0.75) / 2 + 0.002;
      bGroup.add(liquidMesh);

      // Threaded screw cap
      const capGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.02, 16);
      const capMat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.3 });
      const capMesh = new THREE.Mesh(capGeo, capMat);
      capMesh.position.y = bottleHeight + 0.01;
      bGroup.add(capMesh);

      // Color-coded label band
      const labelGeo = new THREE.CylinderGeometry(bottleRadius + 0.001, bottleRadius + 0.001, 0.04, 20, 1, true);
      const labelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
      const labelMesh = new THREE.Mesh(labelGeo, labelMat);
      labelMesh.position.y = bottleHeight * 0.5;
      bGroup.add(labelMesh);

      // Glow highlight ring (active when AI doses)
      const glowGeo = new THREE.RingGeometry(bottleRadius + 0.005, bottleRadius + 0.018, 24);
      glowGeo.rotateX(-Math.PI / 2);
      const glowMat = new THREE.MeshBasicMaterial({
        color: b.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.0,
      });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.y = 0.001;
      bGroup.add(glowMesh);

      // Click to inspect
      bottleMesh.userData = {
        componentId: b.key,
        title: b.name,
        type: 'dosing_bottle',
        subtitle: `${b.chem} · Autonomous AI Managed`,
        faultId: b.faultId,
      };

      this.bottles[b.key] = {
        group: bGroup,
        glowMesh,
        glowMat,
        color: b.color,
        x: b.x,
        z: b.z,
      };

      this.group.add(bGroup);
    });
  }

  _buildPeristalticHeads() {
    // 4 Peristaltic dosing pump heads arranged on an inclined console
    const consoleGeo = new THREE.BoxGeometry(0.32, 0.05, 0.08);
    const consoleMat = new THREE.MeshStandardMaterial({
      color: 0x37474f,
      roughness: 0.4,
      metalness: 0.3,
    });
    const consoleMesh = new THREE.Mesh(consoleGeo, consoleMat);
    consoleMesh.position.set(0, 0.045, 0.08);
    this.group.add(consoleMesh);

    const keys = ['stock-a', 'stock-b', 'stock-acid', 'stock-base'];
    const xOffsets = [-0.12, -0.04, 0.04, 0.12];

    keys.forEach((key, idx) => {
      const headGroup = new THREE.Group();
      headGroup.position.set(xOffsets[idx], 0.07, 0.08);

      // Circular clear rotor casing
      const rotorCaseGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.015, 16);
      rotorCaseGeo.rotateX(Math.PI / 2);
      const rotorCaseMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transmission: 0.8,
        roughness: 0.2,
        transparent: true,
        opacity: 0.7,
      });
      const rotorCase = new THREE.Mesh(rotorCaseGeo, rotorCaseMat);
      headGroup.add(rotorCase);

      // Internal 3-roller rotor that spins when dosing
      const rotor = new THREE.Group();
      const rollerGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.012, 10);
      rollerGeo.rotateX(Math.PI / 2);
      const rollerMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.5 });

      for (let r = 0; r < 3; r++) {
        const roller = new THREE.Mesh(rollerGeo, rollerMat);
        const ang = (r / 3) * Math.PI * 2;
        roller.position.set(Math.cos(ang) * 0.01, Math.sin(ang) * 0.01, 0);
        rotor.add(roller);
      }
      headGroup.add(rotor);
      this.rotors.push({ key, group: rotor });

      this.group.add(headGroup);
    });
  }

  _buildTubing() {
    // Clear silicone tubing from each bottle cap -> pump head -> output manifold into reservoir
    const keys = ['stock-a', 'stock-b', 'stock-acid', 'stock-base'];
    const tubeMat = new THREE.MeshPhysicalMaterial({
      color: 0xecf0f1,
      transmission: 0.9,
      roughness: 0.15,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });

    keys.forEach((key, idx) => {
      const b = this.bottles[key];
      const start = new THREE.Vector3(b.x, 0.14, b.z);
      const mid = new THREE.Vector3(b.x, 0.08, 0.08);
      const end = new THREE.Vector3(-0.25 + idx * 0.03, 0.50, 0.0); // Dosing into tank

      const curve = new THREE.CatmullRomCurve3([
        start,
        new THREE.Vector3(b.x, 0.16, b.z + 0.03),
        mid,
        new THREE.Vector3(b.x * 0.5, 0.25, 0.1),
        end,
      ]);

      const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.0035, 8, false);
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      this.group.add(tubeMesh);

      // Droplet pulses along tube during dosing
      const dropGeo = new THREE.SphereGeometry(0.0045, 6, 6);
      const dropMat = new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.0 });
      const droplet = new THREE.Mesh(dropGeo, dropMat);
      droplet.userData = { curve, progress: 0, active: false };
      this.droplets.push({ key, mesh: droplet, curve, mat: dropMat });
      this.group.add(droplet);
    });
  }

  triggerDose(bottleKey, volumeMl = 10, durationSec = 3.0) {
    const b = this.bottles[bottleKey];
    if (b) {
      b.glowMat.opacity = 0.85;
      this.activeDoses.push({
        bottleKey,
        timer: durationSec,
        maxDuration: durationSec,
      });
    }

    const drop = this.droplets.find((d) => d.key === bottleKey);
    if (drop) {
      drop.mat.opacity = 0.9;
      drop.mesh.userData.active = true;
      drop.mesh.userData.progress = 0;
    }
  }

  update(dt, simTimeSec) {
    // 1. Update active dose timers and peristaltic rotor spins
    for (let i = this.activeDoses.length - 1; i >= 0; i--) {
      const dose = this.activeDoses[i];
      dose.timer -= dt;

      // Spin corresponding peristaltic pump rotor
      const rotor = this.rotors.find((r) => r.key === dose.bottleKey);
      if (rotor) {
        rotor.group.rotation.z -= dt * 12.0; // Fast spin
      }

      // Animate glowing droplet pulse along the tube
      const drop = this.droplets.find((d) => d.key === dose.bottleKey);
      if (drop && drop.mesh.userData.active) {
        drop.mesh.userData.progress = (drop.mesh.userData.progress + dt * 0.8) % 1.0;
        const pt = drop.curve.getPointAt(drop.mesh.userData.progress);
        drop.mesh.position.copy(pt);
      }

      if (dose.timer <= 0) {
        // Fade out glow and reset
        const b = this.bottles[dose.bottleKey];
        if (b) b.glowMat.opacity = 0.0;
        if (drop) {
          drop.mat.opacity = 0.0;
          drop.mesh.userData.active = false;
        }
        this.activeDoses.splice(i, 1);
      }
    }
  }
}
