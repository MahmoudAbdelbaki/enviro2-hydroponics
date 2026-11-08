import * as THREE from 'three';

export class BataviaCropInstancer {
  constructor(portPositions = []) {
    this.group = new THREE.Group();
    this.group.name = 'BataviaCropInstancer';

    this.portPositions = portPositions;
    this.plantCount = portPositions.length;

    this.freshWeightG = 5.0; // Seedling start
    this.stressFactor = 1.0; // Healthy
    this.ageDays = 0;

    this.plants = [];

    this._buildSharedMaterials();
    this._instantiatePlants();
  }

  _buildSharedMaterials() {
    // Slotted black polypropylene net cup
    this.netCupMat = new THREE.MeshStandardMaterial({
      color: 0x1f2421,
      roughness: 0.6,
      metalness: 0.1,
    });

    // Expanded clay hydroton pebbles
    this.pebbleMat = new THREE.MeshStandardMaterial({
      color: 0x8d5b4c,
      roughness: 0.85,
    });

    // Healthy vibrant emerald leaf material with gentle translucency
    this.leafMat = new THREE.MeshStandardMaterial({
      color: 0x2e7d32,
      roughness: 0.38,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    // Middle whorl leaf material
    this.midMat = new THREE.MeshStandardMaterial({
      color: 0x43a047,
      roughness: 0.35,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    // Inner lighter fresh heart leaf
    this.heartMat = new THREE.MeshStandardMaterial({
      color: 0x7cb342,
      roughness: 0.32,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    // Translucent root beard
    this.rootMat = new THREE.MeshStandardMaterial({
      color: 0xf5f5eb,
      roughness: 0.6,
      transparent: true,
      opacity: 0.85,
    });
  }

  _createLeafGeometry(length, width, curlAngle) {
    // Curved, ruffled botanical Batavia lettuce leaf
    const geom = new THREE.PlaneGeometry(width, length, 8, 12);
    geom.translate(0, length / 2, 0); // Anchor leaf stem at origin
    const pos = geom.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const x = pos.getX(i);
      const tY = Math.max(0.0, Math.min(1.0, y / length)); // 0 at base, 1 at tip

      // Realistic curled Batavia ruffle along outer margins
      const ruffle = Math.sin(x * 55.0) * 0.008 * Math.pow(tY, 0.7);
      const curl = Math.pow(tY, 1.8) * Math.sin(curlAngle) * length * 0.45;
      const cupCurvature = (1.0 - Math.pow(Math.min(1.0, Math.abs(x) / (width / 2)), 2)) * 0.006 * tY;

      pos.setZ(i, curl + ruffle - cupCurvature);
      // Natural Batavia leaf shape: narrow at stem, wide in middle, rounded frilled tip
      const taper = Math.sin(tY * Math.PI * 0.85) * 0.55 + 0.45;
      pos.setX(i, x * taper);
    }
    geom.computeVertexNormals();
    return geom;
  }

  _createPlantRosette() {
    const plantGroup = new THREE.Group();

    // 1. Slotted Net Cup (recessed inside gully hole)
    const cupGeo = new THREE.CylinderGeometry(0.024, 0.018, 0.038, 16, 1, true);
    const cupMesh = new THREE.Mesh(cupGeo, this.netCupMat);
    cupMesh.position.y = -0.019;
    plantGroup.add(cupMesh);

    // Slim top flange sitting flush on gully lid
    const flangeGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.003, 16);
    const flange = new THREE.Mesh(flangeGeo, this.netCupMat);
    flange.position.y = 0.0015;
    plantGroup.add(flange);

    // 2. Expanded clay pebbles inside cup
    const pebbleGeo = new THREE.DodecahedronGeometry(0.004, 0);
    const pebbleCluster = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const p = new THREE.Mesh(pebbleGeo, this.pebbleMat);
      const angle = (i / 9) * Math.PI * 2;
      const rad = 0.005 + (i % 3) * 0.004;
      p.position.set(Math.cos(angle) * rad, -0.002, Math.sin(angle) * rad);
      pebbleCluster.add(p);
    }
    plantGroup.add(pebbleCluster);

    // 3. Multi-tier Batavia Lettuce Leaves
    const canopy = new THREE.Group();
    canopy.name = 'canopy';

    // Tier 1: Outer ruffled whorl (12 leaves, spreading outward and draping over rim)
    const outerGeo = this._createLeafGeometry(0.088, 0.062, 0.70);
    this.outerLeaves = [];
    for (let i = 0; i < 12; i++) {
      const leaf = new THREE.Mesh(outerGeo, this.leafMat);
      const rot = (i / 12) * Math.PI * 2 + (i % 2) * 0.08;
      leaf.rotation.y = rot;
      leaf.rotation.x = 1.22; // Outward spreading fan (about 70 deg from vertical)
      leaf.position.y = 0.003;
      leaf.castShadow = true;
      canopy.add(leaf);
      this.outerLeaves.push(leaf);
    }

    // Tier 2: Middle whorl (10 leaves, angled upward at 45 deg)
    const midGeo = this._createLeafGeometry(0.070, 0.050, 0.50);
    for (let i = 0; i < 10; i++) {
      const leaf = new THREE.Mesh(midGeo, this.midMat);
      leaf.rotation.y = (i / 10) * Math.PI * 2 + 0.22;
      leaf.rotation.x = 0.78;
      leaf.position.y = 0.008;
      leaf.castShadow = true;
      canopy.add(leaf);
    }

    // Tier 3: Inner young heart (8 leaves, upright cupped heart)
    const heartGeo = this._createLeafGeometry(0.050, 0.036, 0.25);
    for (let i = 0; i < 8; i++) {
      const leaf = new THREE.Mesh(heartGeo, this.heartMat);
      leaf.rotation.y = (i / 8) * Math.PI * 2 + 0.12;
      leaf.rotation.x = 0.42;
      leaf.position.y = 0.014;
      leaf.castShadow = true;
      canopy.add(leaf);
    }

    // Tier 4: Center bud (4 micro fresh chartreuse curled leaves)
    const budGeo = this._createLeafGeometry(0.034, 0.024, 0.15);
    for (let i = 0; i < 4; i++) {
      const leaf = new THREE.Mesh(budGeo, this.heartMat);
      leaf.rotation.y = (i / 4) * Math.PI * 2 + 0.35;
      leaf.rotation.x = 0.18;
      leaf.position.y = 0.018;
      leaf.castShadow = true;
      canopy.add(leaf);
    }

    plantGroup.add(canopy);
    plantGroup.canopy = canopy;

    // 4. White root beard dipping down into water channel
    const rootGeo = new THREE.ConeGeometry(0.016, 0.05, 8);
    rootGeo.rotateX(Math.PI);
    const rootMesh = new THREE.Mesh(rootGeo, this.rootMat);
    rootMesh.position.y = -0.04;
    plantGroup.add(rootMesh);
    plantGroup.rootMesh = rootMesh;

    // Interactive metadata
    plantGroup.userData = {
      componentId: 'crops',
      title: 'Batavia Lettuce (Lactuca sativa)',
      type: 'crop',
      subtitle: 'Egyptian commercial Batavia cultivar',
    };

    return plantGroup;
  }

  _instantiatePlants() {
    this.portPositions.forEach((port) => {
      const plant = this._createPlantRosette();
      plant.position.copy(port.position);
      plant.rotation.x = port.gullyRotation ?? 0.02;
      plant.rotation.y = Math.random() * Math.PI * 2;
      this.group.add(plant);
      this.plants.push(plant);
    });

    this.setCropState({ freshWeightG: 5.0, stressFactor: 1.0, ageDays: 0 });
  }

  setCropState({ freshWeightG = 5.0, stressFactor = 1.0, ageDays = 0, stressReason = '' }) {
    this.freshWeightG = freshWeightG;
    this.stressFactor = stressFactor;
    this.ageDays = ageDays;

    // Smooth volumetric biomass scaling:
    // Seedling (5g) scale ~0.82 -> Full Harvest (250-320g) scale ~1.50
    const biomassRatio = Math.max(0.01, freshWeightG / 280.0);
    const scaleFactor = 0.82 + 0.68 * Math.pow(biomassRatio, 0.40);

    // Color and droop feedback on crop stress
    const isStressed = stressFactor < 0.85;
    const stressSeverity = Math.max(0.0, Math.min(1.0, (0.85 - stressFactor) / 0.35));

    // Healthy Emerald: #2E7D32 (0.18, 0.49, 0.20)
    // Stressed Yellowing: #C0CA33 (0.75, 0.79, 0.20)
    const rLeaf = 0.18 * (1.0 - stressSeverity) + 0.75 * stressSeverity;
    const gLeaf = 0.49 * (1.0 - stressSeverity) + 0.79 * stressSeverity;
    const bLeaf = 0.20 * (1.0 - stressSeverity) + 0.20 * stressSeverity;

    this.leafMat.color.setRGB(rLeaf, gLeaf, bLeaf);

    // Apply scale and leaf droop to each plant
    this.plants.forEach((p, idx) => {
      // Natural plant-to-plant size variance (±8%)
      const variance = 0.94 + ((idx * 7) % 13) * 0.01;
      const s = scaleFactor * variance;
      p.canopy.scale.set(s, s, s);

      // Root beard grows longer as crop matures
      const rootScale = Math.min(1.6, 0.5 + 1.1 * Math.pow(biomassRatio, 0.4));
      p.rootMesh.scale.set(s * 0.8, rootScale, s * 0.8);

      // Outer leaf drooping if stressed
      if (isStressed) {
        p.canopy.rotation.x = Math.sin(idx) * 0.05 * stressSeverity;
      } else {
        p.canopy.rotation.x = 0;
      }
    });
  }

  update(dt, simTimeSec) {
    // Gentle canopy breeze sway
    const breeze = Math.sin(simTimeSec * 1.8) * 0.015;
    this.plants.forEach((p, idx) => {
      p.canopy.rotation.z = Math.sin(simTimeSec * 2.0 + idx) * breeze;
    });
  }
}
