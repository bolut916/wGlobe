/**
 * Orbit camera for a spherical planet.
 *
 * State (float64): target direction t̂ (unit ECEF), range ρ (meters from the
 * camera to the target surface point), heading h and tilt τ (radians).
 *
 *   T  = R · t̂                                   target on the surface
 *   up = t̂,  north/east = local tangent frame
 *   f  = north·cos h + east·sin h                 horizontal forward
 *   d  = −up·cos τ + f·sin τ                      view direction
 *   C  = T − d · ρ                                camera position
 *   camera basis: X = east·cos h − north·sin h, Y = up·sin τ + f·cos τ, Z = −d
 *
 * Interaction is "grab the Earth": the surface point under a finger is found
 * by ray–sphere intersection when the finger lands, and every subsequent move
 * rotates the target by the rotation that brings that point back under the
 * finger. Pinch zoom changes ρ and then re-applies the same lock around the
 * pinch centroid, so the pinched place never slides.
 */
import * as THREE from 'three';

import {
  angleDelta,
  clamp,
  cross3,
  DEG2RAD,
  dot3,
  dampFactor,
  ecefToGeodetic,
  enuBasis,
  geodeticToEcef,
  lerp,
  normalize3,
  RAD2DEG,
  raySphere,
  rotateAroundAxis,
  setVec3,
  slerpUnit,
  smoothstep,
  smootherstep,
  type Vec3,
} from '../math/sphericalMath';
import type { CameraPose, FlyToOptions, GlobeEngineConfig } from '../types/globe';

interface Pointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
}

interface Flight {
  fromTarget: Vec3;
  toTarget: Vec3;
  fromRange: number;
  toRange: number;
  hump: number;
  fromHeading: number;
  headingDelta: number;
  fromTilt: number;
  toTilt: number;
  start: number;
  duration: number;
  onComplete?: (completed: boolean) => void;
}

export interface CameraControllerEvents {
  /** Fired every 15° of longitude the user drags across (haptic detents). */
  onDetent?: () => void;
  /** A short press-release without movement (screen coordinates in layout px). */
  onTap?: (x: number, y: number) => void;
  /** Any user interaction started (used to pause auto-rotation, close hints…). */
  onInteractionStart?: () => void;
}

const TAP_SLOP_PX = 8;
const TAP_MAX_MS = 280;
const INERTIA_DAMPING = 3.2;
const ZOOM_INERTIA_DAMPING = 6;
const MAX_TILT_RAD = 70 * DEG2RAD;
const DETENT_RAD = 15 * DEG2RAD;
const AUTO_ROTATE_DELAY_MS = 3500;

export class GlobeCameraController {
  readonly target: Vec3 = { x: 1, y: 0, z: 0 };
  range: number;
  heading = 0;
  tilt = 0;

  autoRotate = false;
  /** Degrees per second of idle spin at high altitude. */
  autoRotateSpeed = 2.4;
  enabled = true;

  private readonly radius: number;
  private readonly minRange: number;
  private readonly maxRange: number;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private pointers = new Map<number, Pointer>();
  private grabPoint: Vec3 | null = null;
  private pinchStartDistance = 0;
  private pinchStartRange = 0;
  private pinchStartAngle = 0;
  private pinchStartHeading = 0;
  private pinchLastCentroidY = 0;
  private twoFingerMode: 'undecided' | 'zoom' | 'tilt' = 'undecided';
  /** Angular velocity of the drag (axis · rad/s). */
  private readonly spin: Vec3 = { x: 0, y: 0, z: 0 };
  private zoomVelocity = 0;
  private lastMoveTime = 0;
  private flight: Flight | null = null;
  private lastInteraction = -Infinity;
  private detentLon = 0;
  private pressStart = 0;
  private readonly events: CameraControllerEvents;

  private readonly east: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly north: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly up: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly scratchA: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly scratchB: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly rayDir = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly geo = { lat: 0, lon: 0, r: 0 };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    config: GlobeEngineConfig,
    initial: { lat: number; lon: number; altitude: number },
    events: CameraControllerEvents = {},
  ) {
    this.radius = config.radius;
    this.minRange = config.minAltitude;
    this.maxRange = config.maxAltitude;
    this.events = events;
    geodeticToEcef(this.target, initial.lat * DEG2RAD, initial.lon * DEG2RAD, 1);
    this.range = clamp(initial.altitude, this.minRange, this.maxRange);
    this.detentLon = initial.lon * DEG2RAD;
    this.applyToCamera();
  }

  setViewport(widthPx: number, heightPx: number): void {
    this.viewportWidth = Math.max(1, widthPx);
    this.viewportHeight = Math.max(1, heightPx);
  }

  // ── Derived quantities ──────────────────────────────────────

  /** Altitude of the camera above the sphere (meters). */
  get altitude(): number {
    const c = this.cameraEcef(this.scratchA);
    return Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z) - this.radius;
  }

  /** Tilt allowed at the current range: none from orbit, up to 70° near the ground. */
  maxTiltForRange(range: number): number {
    return MAX_TILT_RAD * (1 - smoothstep(25_000, 2_500_000, range));
  }

  getPose(): CameraPose {
    ecefToGeodetic(this.target, this.geo);
    return {
      lat: this.geo.lat * RAD2DEG,
      lon: this.geo.lon * RAD2DEG,
      altitude: this.range,
      heading: this.heading * RAD2DEG,
      tilt: this.tilt * RAD2DEG,
    };
  }

  private updateFrame(): void {
    ecefToGeodetic(this.target, this.geo);
    enuBasis(this.geo.lat, this.geo.lon, this.east, this.north, this.up);
  }

  /** Camera position in ECEF (meters, float64). */
  cameraEcef(out: Vec3): Vec3 {
    this.updateFrame();
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    const ct = Math.cos(this.tilt);
    const st = Math.sin(this.tilt);
    const fx = this.north.x * ch + this.east.x * sh;
    const fy = this.north.y * ch + this.east.y * sh;
    const fz = this.north.z * ch + this.east.z * sh;
    // C = T + (up·cosτ − f·sinτ)·ρ
    return setVec3(
      out,
      this.target.x * this.radius + (this.up.x * ct - fx * st) * this.range,
      this.target.y * this.radius + (this.up.y * ct - fy * st) * this.range,
      this.target.z * this.radius + (this.up.z * ct - fz * st) * this.range,
    );
  }

  /** Writes orientation into the camera (its position stays at the origin). */
  applyToCamera(): void {
    this.updateFrame();
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    const ct = Math.cos(this.tilt);
    const st = Math.sin(this.tilt);
    const f = new THREE.Vector3(this.north.x * ch + this.east.x * sh, this.north.y * ch + this.east.y * sh, this.north.z * ch + this.east.z * sh);
    const up = new THREE.Vector3(this.up.x, this.up.y, this.up.z);
    const xAxis = new THREE.Vector3(this.east.x * ch - this.north.x * sh, this.east.y * ch - this.north.y * sh, this.east.z * ch - this.north.z * sh);
    const yAxis = up.clone().multiplyScalar(st).addScaledVector(f, ct);
    const zAxis = up.clone().multiplyScalar(ct).addScaledVector(f, -st);
    this.basis.makeBasis(xAxis, yAxis, zAxis);
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.setFromRotationMatrix(this.basis);
    this.camera.updateMatrixWorld(true);
  }

  // ── Picking ─────────────────────────────────────────────────

  /** World (camera-relative = ECEF-oriented) unit ray through a screen point. */
  screenRay(x: number, y: number, out: Vec3): Vec3 {
    const ndcX = (x / this.viewportWidth) * 2 - 1;
    const ndcY = -(y / this.viewportHeight) * 2 + 1;
    this.rayDir.set(ndcX, ndcY, 0.5).unproject(this.camera).normalize();
    return setVec3(out, this.rayDir.x, this.rayDir.y, this.rayDir.z);
  }

  /**
   * Unit surface direction under a screen point. When the ray misses the
   * sphere, the nearest point of the visible limb is returned so that a drag
   * started in space still turns the globe continuously.
   */
  pickSurface(x: number, y: number, out: Vec3): boolean {
    const origin = this.cameraEcef(this.scratchB);
    const dir = this.screenRay(x, y, out);
    const t = raySphere(origin, dir, this.radius);
    if (t >= 0) {
      setVec3(out, origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
      normalize3(out, out);
      return true;
    }
    // Closest point of the ray to the centre, pushed onto the sphere.
    const tc = -dot3(origin, dir);
    setVec3(out, origin.x + dir.x * tc, origin.y + dir.y * tc, origin.z + dir.z * tc);
    normalize3(out, out);
    return false;
  }

  /** Strict pick: lat/lon (degrees) under a screen point, or null in space. */
  pickLatLon(x: number, y: number): { lat: number; lon: number } | null {
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    if (!this.pickSurface(x, y, p)) return null;
    ecefToGeodetic(p, this.geo);
    return { lat: this.geo.lat * RAD2DEG, lon: this.geo.lon * RAD2DEG };
  }

  /** Rotates the target so that unit surface point `from` lands on `to`'s place. */
  private rotateTargetBetween(from: Vec3, to: Vec3): { axis: Vec3; angle: number } | null {
    // Rotating `from` by +angle about (from × to) carries it onto `to`.
    const axis = cross3({ x: 0, y: 0, z: 0 }, from, to);
    const sinA = Math.sqrt(dot3(axis, axis));
    const cosA = clamp(dot3(from, to), -1, 1);
    const angle = Math.atan2(sinA, cosA);
    if (sinA < 1e-12 || angle < 1e-12) return null;
    normalize3(axis, axis);
    rotateAroundAxis(this.target, this.target, axis, angle);
    normalize3(this.target, this.target);
    return { axis, angle };
  }

  /** Keeps `anchor` (unit surface direction) under the screen point (x, y). */
  private lockAnchorUnder(anchor: Vec3, x: number, y: number): { axis: Vec3; angle: number } | null {
    const current: Vec3 = { x: 0, y: 0, z: 0 };
    let result: { axis: Vec3; angle: number } | null = null;
    // Three fixed-point iterations: the rotation changes the local frame slightly
    // (residual after three is far below one pixel at every altitude).
    for (let i = 0; i < 3; i += 1) {
      this.applyToCamera();
      this.pickSurface(x, y, current);
      const step = this.rotateTargetBetween(current, anchor);
      if (!step) break;
      if (!result) result = step;
      else result.angle += step.angle;
    }
    return result;
  }

  // ── Pointer input (layout pixels) ────────────────────────────

  pointerDown(id: number, x: number, y: number, now: number): void {
    if (!this.enabled) return;
    this.cancelFlight();
    this.events.onInteractionStart?.();
    this.lastInteraction = now;
    setVec3(this.spin, 0, 0, 0);
    this.zoomVelocity = 0;
    this.pointers.set(id, { id, x, y, startX: x, startY: y });
    if (this.pointers.size === 1) {
      this.pressStart = now;
      this.grabPoint = { x: 0, y: 0, z: 0 };
      this.pickSurface(x, y, this.grabPoint);
    } else if (this.pointers.size === 2) {
      this.beginPinch();
    }
    this.lastMoveTime = now;
  }

  pointerMove(id: number, x: number, y: number, now: number): void {
    const p = this.pointers.get(id);
    if (!p || !this.enabled) return;
    p.x = x;
    p.y = y;
    this.lastInteraction = now;
    const dt = Math.max((now - this.lastMoveTime) / 1000, 1 / 240);
    this.lastMoveTime = now;

    if (this.pointers.size === 1 && this.grabPoint) {
      const step = this.lockAnchorUnder(this.grabPoint, x, y);
      if (step) {
        const k = dampFactor(18, dt);
        const vx = (step.axis.x * step.angle) / dt;
        const vy = (step.axis.y * step.angle) / dt;
        const vz = (step.axis.z * step.angle) / dt;
        setVec3(this.spin, lerp(this.spin.x, vx, k), lerp(this.spin.y, vy, k), lerp(this.spin.z, vz, k));
      }
      this.emitDetents();
      this.applyToCamera();
    } else if (this.pointers.size >= 2) {
      this.updatePinch(dt);
    }
  }

  pointerUp(id: number, now: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    this.pointers.delete(id);
    this.lastInteraction = now;
    const moved = Math.hypot(p.x - p.startX, p.y - p.startY);
    if (this.pointers.size === 0) {
      if (moved < TAP_SLOP_PX && now - this.pressStart < TAP_MAX_MS) {
        setVec3(this.spin, 0, 0, 0);
        this.events.onTap?.(p.x, p.y);
      } else if (now - this.lastMoveTime > 90) {
        setVec3(this.spin, 0, 0, 0);
      }
      this.grabPoint = null;
    } else if (this.pointers.size === 1) {
      // Back to one finger: re-grab under the remaining pointer.
      const rest = [...this.pointers.values()][0];
      if (rest) {
        this.grabPoint = { x: 0, y: 0, z: 0 };
        this.pickSurface(rest.x, rest.y, this.grabPoint);
      }
      setVec3(this.spin, 0, 0, 0);
    }
  }

  pointerCancel(): void {
    this.pointers.clear();
    this.grabPoint = null;
  }

  private twoPointers(): [Pointer, Pointer] | null {
    const values = [...this.pointers.values()];
    const a = values[0];
    const b = values[1];
    return a && b ? [a, b] : null;
  }

  private beginPinch(): void {
    const pair = this.twoPointers();
    if (!pair) return;
    const [a, b] = pair;
    this.pinchStartDistance = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
    this.pinchStartRange = this.range;
    this.pinchStartAngle = Math.atan2(b.y - a.y, b.x - a.x);
    this.pinchStartHeading = this.heading;
    this.pinchLastCentroidY = (a.y + b.y) / 2;
    this.twoFingerMode = 'undecided';
    for (const p of pair) {
      p.startX = p.x;
      p.startY = p.y;
    }
    this.grabPoint = { x: 0, y: 0, z: 0 };
    this.pickSurface((a.x + b.x) / 2, (a.y + b.y) / 2, this.grabPoint);
  }

  private updatePinch(dt: number): void {
    const pair = this.twoPointers();
    if (!pair || !this.grabPoint) return;
    const [a, b] = pair;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const distance = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);

    if (this.twoFingerMode === 'undecided') {
      const dyA = a.y - a.startY;
      const dyB = b.y - b.startY;
      const spread = Math.abs(distance - this.pinchStartDistance);
      const parallel = Math.sign(dyA) === Math.sign(dyB) && Math.min(Math.abs(dyA), Math.abs(dyB)) > 10;
      const horizontalPair = Math.abs(b.y - a.y) < Math.abs(b.x - a.x) * 0.8;
      if (parallel && horizontalPair && spread < 14 && this.maxTiltForRange(this.range) > 0.05) this.twoFingerMode = 'tilt';
      else if (spread > 6 || Math.hypot(cx - (a.startX + b.startX) / 2, cy - (a.startY + b.startY) / 2) > 6) this.twoFingerMode = 'zoom';
      else return;
    }

    if (this.twoFingerMode === 'tilt') {
      const dy = cy - this.pinchLastCentroidY;
      this.pinchLastCentroidY = cy;
      this.tilt = clamp(this.tilt - dy * 0.0055, 0, this.maxTiltForRange(this.range));
      this.applyToCamera();
      return;
    }

    // Zoom: exact finger-distance ratio, then pivot lock at the centroid.
    const previousRange = this.range;
    this.range = clamp(this.pinchStartRange * (this.pinchStartDistance / distance), this.minRange, this.maxRange);
    this.tilt = Math.min(this.tilt, this.maxTiltForRange(this.range));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const twist = angleDelta(this.pinchStartAngle, angle);
    if (Math.abs(twist) > 0.14 || this.heading !== this.pinchStartHeading) {
      this.heading = this.pinchStartHeading - twist;
    }
    this.applyToCamera();
    this.lockAnchorUnder(this.grabPoint, cx, cy);
    this.applyToCamera();
    const rate = Math.log(this.range / previousRange) / dt;
    this.zoomVelocity = lerp(this.zoomVelocity, rate, dampFactor(14, dt));
    this.emitDetents();
  }

  /** Mouse wheel / trackpad zoom around the cursor. */
  wheel(x: number, y: number, deltaY: number, now: number): void {
    if (!this.enabled) return;
    this.cancelFlight();
    this.events.onInteractionStart?.();
    this.lastInteraction = now;
    const anchor: Vec3 = { x: 0, y: 0, z: 0 };
    const onSurface = this.pickSurface(x, y, anchor);
    this.range = clamp(this.range * Math.exp(deltaY * 0.0016), this.minRange, this.maxRange);
    this.tilt = Math.min(this.tilt, this.maxTiltForRange(this.range));
    this.applyToCamera();
    if (onSurface) this.lockAnchorUnder(anchor, x, y);
    this.applyToCamera();
  }

  tiltBy(radians: number): void {
    this.tilt = clamp(this.tilt + radians, 0, this.maxTiltForRange(this.range));
    this.applyToCamera();
  }

  rotateHeadingBy(radians: number): void {
    this.heading = angleDelta(0, this.heading + radians);
    this.applyToCamera();
  }

  private emitDetents(): void {
    ecefToGeodetic(this.target, this.geo);
    const travelled = angleDelta(this.detentLon, this.geo.lon);
    if (Math.abs(travelled) >= DETENT_RAD) {
      this.detentLon = this.geo.lon;
      this.events.onDetent?.();
    }
  }

  // ── Flights ─────────────────────────────────────────────────

  /**
   * Great-circle flight. The target slides along the geodesic with
   * smootherstep timing while the range follows log-space interpolation plus a
   * parabolic hump 4e(1−e)·H, so long trips rise high enough to show the route.
   */
  flyTo(options: FlyToOptions, now: number): void {
    this.cancelFlight();
    const to = geodeticToEcef({ x: 0, y: 0, z: 0 }, options.lat * DEG2RAD, options.lon * DEG2RAD, 1);
    const angle = Math.acos(clamp(dot3(this.target, to), -1, 1));
    const toRange = clamp(options.altitude ?? this.range, this.minRange, this.maxRange);
    const arcLength = angle * this.radius;
    const desiredPeak = Math.min(arcLength * 0.55, this.maxRange * 0.6);
    const hump = Math.max(0, desiredPeak - Math.max(this.range, toRange));
    const duration = options.duration ?? clamp(900 + 2100 * (angle / Math.PI) + 450 * Math.abs(Math.log10(toRange / this.range)), 900, 3800);
    const toTilt = clamp((options.tilt ?? 0) * DEG2RAD, 0, this.maxTiltForRange(toRange));
    this.flight = {
      fromTarget: { x: this.target.x, y: this.target.y, z: this.target.z },
      toTarget: to,
      fromRange: this.range,
      toRange,
      hump,
      fromHeading: this.heading,
      headingDelta: angleDelta(this.heading, (options.heading ?? 0) * DEG2RAD),
      fromTilt: this.tilt,
      toTilt,
      start: now,
      duration: Math.max(duration, 1),
      onComplete: options.onComplete,
    };
    setVec3(this.spin, 0, 0, 0);
    this.zoomVelocity = 0;
  }

  get isFlying(): boolean {
    return this.flight !== null;
  }

  cancelFlight(): void {
    if (!this.flight) return;
    const cb = this.flight.onComplete;
    this.flight = null;
    cb?.(false);
  }

  // ── Per-frame update ────────────────────────────────────────

  /** Advances flights, inertia and auto-rotation. Returns true while the view moves. */
  update(dtSeconds: number, now: number): boolean {
    const dt = clamp(dtSeconds, 0, 0.1);
    let moving = false;

    if (this.flight) {
      const f = this.flight;
      const t = clamp((now - f.start) / f.duration, 0, 1);
      const e = smootherstep(t);
      slerpUnit(this.target, f.fromTarget, f.toTarget, e);
      normalize3(this.target, this.target);
      const logRange = lerp(Math.log(f.fromRange), Math.log(f.toRange), e);
      this.range = Math.exp(logRange) + f.hump * 4 * e * (1 - e);
      this.heading = f.fromHeading + f.headingDelta * e;
      this.tilt = Math.min(lerp(f.fromTilt, f.toTilt, e), this.maxTiltForRange(this.range));
      moving = true;
      if (t >= 1) {
        this.flight = null;
        f.onComplete?.(true);
      }
    } else if (this.pointers.size === 0) {
      const spinMag = Math.sqrt(dot3(this.spin, this.spin));
      if (spinMag > 1e-5) {
        const axis = normalize3(this.scratchA, this.spin);
        rotateAroundAxis(this.target, this.target, axis, spinMag * dt);
        normalize3(this.target, this.target);
        const k = Math.exp(-INERTIA_DAMPING * dt);
        setVec3(this.spin, this.spin.x * k, this.spin.y * k, this.spin.z * k);
        this.emitDetents();
        moving = true;
      }
      if (Math.abs(this.zoomVelocity) > 1e-3) {
        this.range = clamp(this.range * Math.exp(this.zoomVelocity * dt), this.minRange, this.maxRange);
        this.zoomVelocity *= Math.exp(-ZOOM_INERTIA_DAMPING * dt);
        this.tilt = Math.min(this.tilt, this.maxTiltForRange(this.range));
        moving = true;
      }
      if (this.autoRotate && now - this.lastInteraction > AUTO_ROTATE_DELAY_MS && spinMag <= 1e-5) {
        // Spin around the polar axis, fading out as the camera approaches the ground.
        const strength = smoothstep(1_500_000, 6_000_000, this.range);
        if (strength > 0) {
          const axis = setVec3(this.scratchB, 0, 1, 0);
          rotateAroundAxis(this.target, this.target, axis, -this.autoRotateSpeed * DEG2RAD * strength * dt);
          moving = true;
        }
      }
    }

    // Tilt eases back into the allowed cone when zooming out.
    const maxTilt = this.maxTiltForRange(this.range);
    if (this.tilt > maxTilt) this.tilt = lerp(this.tilt, maxTilt, dampFactor(10, dt));

    this.applyToCamera();
    return moving;
  }

  /** Marks user activity (pauses idle auto-rotation). */
  touchActivity(now: number): void {
    this.lastInteraction = now;
  }
}
