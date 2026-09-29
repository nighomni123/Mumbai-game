/**
 * World layout for the Charni Road district, in metres at 1:1.
 *
 * The rule is that every number here is a real dimension. A suburban
 * platform is about 4 m wide, a running line 4 m gauge on 3.5 m centres, a
 * carriageway 14 m kerb to kerb, a Zebra crossing 4 m deep. Nothing is
 * exaggerated for effect — the lifelikeness comes from the numbers being
 * right, not from them being large.
 *
 * X runs along the line (east-west in world space).
 * Z runs across it: negative is the road side, positive is the station side.
 */

export const L = {
  // ---- extents -----------------------------------------------------------
  /** Half-length of the built district along the line. */
  halfX: 90,
  /**
   * Player spawn, at the west end of the platform. Standing mid-platform puts
   * the eye inside the 57 m length of the stopped local, which walls the whole
   * street off. From here the train sits ahead-and-right at an angle, the
   * footbridge closes the far end, and the carriageway is visible past the
   * train's tail.
   */
  spawn: { x: -34, z: 0 },

  // ---- island platform ---------------------------------------------------
  /** Platform is 4 m wide, centred on z = 0. */
  platformZ: 2,
  platformH: 1.1, // suburban platforms stand about a metre above rail
  platformLength: 180,

  // ---- track -------------------------------------------------------------
  /** Running-line centres either side of the island. */
  trackZ: [-10, -6, 6, 10],
  /** Gauge, and sleeper spacing. */
  gauge: 1.676,
  sleeperStep: 0.65,
  ballastHalfWidth: 2.4,

  // ---- road side (negative Z) -------------------------------------------
  /** Kerb face of the near footpath. */
  footpathNear: [-16, -12],
  /** Carriageway, kerb to kerb. */
  road: [-30, -16],
  /** Far footpath, then the building line. */
  footpathFar: [-34, -30],
  buildingLine: -36,

  // ---- station side (positive Z) ----------------------------------------
  /** The far side of the tracks, then the station building. */
  stationApron: [12, 14],
  buildingNear: 16,
  buildingFar: 44,

  // ---- kerb + markings ---------------------------------------------------
  kerbHeight: 0.15,
  kerbStripe: 1.2, // black/yellow segment length along the kerb

  // ---- footbridge --------------------------------------------------------
  /** Spans the tracks, north-south, clear height over rail. */
  bridgeZ: [-13, 15],
  bridgeDeckY: 6.4,
  bridgeWidth: 3.0,

  // ---- light -------------------------------------------------------------
  /** Late-May evening: the sun is low and well to the west (negative X). */
  sunAzimuth: [-0.62, 0.34, 0.71],
  sunElevation: 0.30,
} as const;

/** Distance from a point to the nearest running-line centre. */
export function distToTrack(z: number): number {
  let d = Infinity;
  for (const t of L.trackZ) d = Math.min(d, Math.abs(z - t));
  return d;
}

/** True if (x,z) is on walkable platform. */
export function onPlatform(x: number, z: number): boolean {
  return Math.abs(x) <= L.platformLength / 2 && Math.abs(z) <= L.platformZ;
}
