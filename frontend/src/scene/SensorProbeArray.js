import * as THREE from 'three';

export class SensorProbeArray {
  constructor(spec = {}, tankPos = { x: -0.65, y: 0, z: 0.65 }) {
    this.group = new THREE.Group();
    this.group.name = 'SensorProbeArray';
    this.tankPos = tankPos;

    this.probes = [];
    this.floatingPins = [];

    this._buildProbes();
  }

  _buildProbes() {
    const tx = this.tankPos?.x ?? -0.65;
    const tz = this.tankPos?.z ?? 0.65;

    // 1. pH Sensor in Reservoir (Glass combination electrode)
    const phGroup = new THREE.Group();
    phGroup.position.set(tx - 0.12, 0.48, tz + 0.08);

    const phBodyGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.18, 12);
    const phBodyMat = new THREE.MeshStandardMaterial({ color: 0x1976d2, roughness: 0.3 });
    const phBody = new THREE.Mesh(phBodyGeo, phBodyMat);
    phBody.castShadow = true;
    phGroup.add(phBody);

    // Glass bulb tip
    const bulbGeo = new THREE.SphereGeometry(0.007, 10, 10);
    const bulbMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0f7fa,
      transmission: 0.85,
      roughness: 0.1,
      transparent: true,
      opacity: 0.8,
    });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.y = -0.09;
    phGroup.add(bulb);

    phBody.userData = {
      componentId: 'sen-ph-1',
      title: 'Combination pH Electrode',
      type: 'sensor',
      sensorKind: 'pH',
      unit: 'pH',
      subtitle: 'Glass BNC electrode immersed in reservoir',
      faultId: 'drift', // Can be drifted!
    };
    this.group.add(phGroup);
    this.probes.push({ id: 'sen-ph-1', kind: 'pH', mesh: phBody, group: phGroup, worldY: 0.52 });

    // 2. EC Sensor in Reservoir (Toroidal / 4-electrode platinum cell)
    const ecGroup = new THREE.Group();
    ecGroup.position.set(tx - 0.04, 0.48, tz + 0.08);

    const ecBodyGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.18, 12);
    const ecBodyMat = new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.3 });
    const ecBody = new THREE.Mesh(ecBodyGeo, ecBodyMat);
    ecBody.castShadow = true;
    ecGroup.add(ecBody);

    // Platinum rings
    const ringGeo = new THREE.CylinderGeometry(0.0095, 0.0095, 0.008, 12);
    const platMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, metalness: 0.9, roughness: 0.2 });
    const ring1 = new THREE.Mesh(ringGeo, platMat);
    ring1.position.y = -0.06;
    ecGroup.add(ring1);
    const ring2 = new THREE.Mesh(ringGeo, platMat);
    ring2.position.y = -0.075;
    ecGroup.add(ring2);

    ecBody.userData = {
      componentId: 'sen-ec-1',
      title: 'Conductivity (EC) Sensor',
      type: 'sensor',
      sensorKind: 'EC',
      unit: 'dS/m',
      subtitle: 'Platinum electrode cell measuring ionic strength',
    };
    this.group.add(ecGroup);
    this.probes.push({ id: 'sen-ec-1', kind: 'EC', mesh: ecBody, group: ecGroup, worldY: 0.52 });

    // 3. Water Temp (RTD Pt100) in Reservoir
    const twGroup = new THREE.Group();
    twGroup.position.set(tx + 0.04, 0.48, tz + 0.08);
    const twGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.18, 10);
    const ssMat = new THREE.MeshStandardMaterial({ color: 0xb0bec5, metalness: 0.85, roughness: 0.2 });
    const twBody = new THREE.Mesh(twGeo, ssMat);
    twGroup.add(twBody);
    twBody.userData = {
      componentId: 'sen-tw-1',
      title: 'Water Temp Thermowell',
      type: 'sensor',
      sensorKind: 'T_w',
      unit: '°C',
      subtitle: 'Stainless steel Pt100 temperature sensor',
    };
    this.group.add(twGroup);
    this.probes.push({ id: 'sen-tw-1', kind: 'T_w', mesh: twBody, group: twGroup, worldY: 0.52 });

    // 4. Ultrasonic Tank Level Sensor (top of reservoir)
    const vGroup = new THREE.Group();
    vGroup.position.set(tx - 0.08, 0.56, tz - 0.08);
    const vGeo = new THREE.CylinderGeometry(0.016, 0.018, 0.035, 16);
    const vMat = new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.4 });
    const vBody = new THREE.Mesh(vGeo, vMat);
    vGroup.add(vBody);
    vBody.userData = {
      componentId: 'sen-vres-1',
      title: 'Ultrasonic Tank Level Sensor',
      type: 'sensor',
      sensorKind: 'V_res',
      unit: 'L',
      subtitle: 'Non-contact ultrasonic level transducer',
    };
    this.group.add(vGroup);
    this.probes.push({ id: 'sen-vres-1', kind: 'V_res', mesh: vBody, group: vGroup, worldY: 0.62 });

    // 5. Optical Dissolved Oxygen (DO) Sensor at Gully Outlet
    const doGroup = new THREE.Group();
    doGroup.position.set(0.12, 0.68, 0.82); // Mounted at Bay B low drain manifold
    const doGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.12, 12);
    doGeo.rotateX(0.3);
    const doMat = new THREE.MeshStandardMaterial({ color: 0x0288d1, roughness: 0.4 });
    const doBody = new THREE.Mesh(doGeo, doMat);
    doGroup.add(doBody);

    // Luminescent optical cap (glows blue/cyan)
    const capGeo = new THREE.SphereGeometry(0.009, 10, 10);
    const capMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const doCap = new THREE.Mesh(capGeo, capMat);
    doCap.position.set(0, -0.05, 0.015);
    doGroup.add(doCap);

    doBody.userData = {
      componentId: 'sen-do-1',
      title: 'Root-Zone Oxygen Probe (DO)',
      type: 'sensor',
      sensorKind: 'DO',
      unit: 'mg/L',
      subtitle: 'Optical luminescence probe at gully drain discharge',
    };
    this.group.add(doGroup);
    this.probes.push({ id: 'sen-do-1', kind: 'DO', mesh: doBody, group: doGroup, worldY: 0.75 });

    // 6. Climate Station Probe (Air Temp, Humidity, CO2) suspended above canopy
    const clGroup = new THREE.Group();
    clGroup.position.set(0, 1.25, 0);
    // Multi-plate louvered radiation shield
    for (let i = 0; i < 5; i++) {
      const plateGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.006, 16);
      const plateMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.position.y = i * 0.012;
      plate.castShadow = true;
      clGroup.add(plate);
    }
    const clBody = clGroup.children[2]; // Use middle plate for click target
    clBody.userData = {
      componentId: 'sen-tair-1',
      title: 'Canopy Micro-Climate Station',
      type: 'sensor',
      sensorKind: 'T_air',
      unit: '°C',
      subtitle: 'Aspirated radiation shield (T_air, RH, CO₂)',
    };
    this.group.add(clGroup);
    this.probes.push({ id: 'sen-tair-1', kind: 'T_air', mesh: clBody, group: clGroup, worldY: 1.15 });

    // Build 3D Floating Pill Badges
    this._buildFloatingPills();
  }

  _buildFloatingPills() {
    // Sleek compact 3D sensor pin markers
    this.probes.forEach((p) => {
      // 1. Glowing status indicator bead at probe head
      const beadGeo = new THREE.SphereGeometry(0.009, 12, 12);
      const beadMat = new THREE.MeshStandardMaterial({
        color: 0x238a4e,
        emissive: 0x238a4e,
        emissiveIntensity: 0.4,
        roughness: 0.3,
      });
      const bead = new THREE.Mesh(beadGeo, beadMat);
      bead.position.y = 0.09;
      p.group.add(bead);
      p.beadMat = beadMat;

      // 2. High-res compact reading badge
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 48;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.strokeStyle = '#CFD8DC';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(4, 4, 152, 40, 20);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#18221D';
      ctx.font = 'bold 20px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.kind, 80, 24);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(0.08, 0.024, 1.0);
      sprite.position.set(p.group.position.x, p.worldY + 0.025, p.group.position.z);

      this.group.add(sprite);
      this.floatingPins.push({
        probe: p,
        sprite,
        canvas,
        ctx,
        texture,
        baseY: p.worldY + 0.025,
      });
    });
  }

  updateReadings(readings = {}) {
    this.floatingPins.forEach((pin) => {
      const val = readings[pin.probe.id] ?? readings[pin.probe.kind];
      if (val != null) {
        const text = `${pin.probe.kind} ${Number(val).toFixed(pin.probe.kind === 'pH' || pin.probe.kind === 'EC' ? 2 : 1)}`;
        const ctx = pin.ctx;
        ctx.clearRect(0, 0, 160, 48);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
        ctx.strokeStyle = '#B0BEC5';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(4, 4, 152, 40, 20);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#18221D';
        ctx.font = 'bold 20px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 80, 24);

        pin.texture.needsUpdate = true;
      }
    });
  }

  update(dt, simTimeSec) {
    // Gentle floating bob for pins
    this.floatingPins.forEach((pin, i) => {
      pin.sprite.position.y = pin.baseY + Math.sin(simTimeSec * 2.5 + i) * 0.006;
    });
  }
}
