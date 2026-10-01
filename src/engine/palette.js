/**
 * Every colour in the Mumbai world.
 *
 * Values are anchored on the reference render (a late-May evening at
 * Charni Road): a cream base at hue 47 (#EFE6C4) over a single dark-navy
 * road tone (#3C3E4C) at hue 232, with the sky carrying the sunset. Keeping
 * the palette this tight is what lets the world ship with no texture maps —
 * flat bands only — and every object that deviates reads as a hot accent.
 */

export const PAL = {
  // ---- sky / atmosphere (the nine keys the engine requires) -------------
  skyTop: 0x8f7fa8,      // lilac-mauve zenith
  skyMid: 0xe8b9a0,      // peach
  skyHaze: 0xf6dcae,     // warm cream at the horizon
  cloud: 0xfff0d8,       // cel cloud body
  cloudShade: 0xb9a2c4,  // violet cloud underside — the "anime" note
  hill: 0xa89a86,        // near ridge
  hillFar: 0xc0b4a4,     // far ridge
  ink: 0x2b2733,         // outline + line art
  glassDark: 0x3a4150,

  // ---- light ------------------------------------------------------------
  sun: 0xfff0cf,         // warm low sun
  bounce: 0x9fb4e8,      // cool fill from the opposite quarter
  ambient: 0x9d8fbe,     // hemisphere ground tint (cool)
  shadowFill: 0x6f6396,   // cool ambient fill — keeps shadows violet, not brown
  fog: 0xf0dcb4,         // warm haze, matches the horizon

  // ---- ground -----------------------------------------------------------
  groundLand: 0xd8d2c2,    // unlit land base under every tile (never toon-lit)
  // --- ground tone families -------------------------------------------
  // Measured 2026-09-30: one flat ground plane covered ~30% of a street frame
  // and returned the identical colour in five of six sampled columns. These are
  // the variations it is now subdivided into. All low chroma deliberately —
  // ground should read as ground, and the accents belong on the buildings.
  groundPaving: 0xd2ccbc,  // worn paving / packed earth
  groundWorn:   0xc8bda6,  // bare earth showing through
  groundPale:   0xe0dacb,  // sun-bleached
  sea: 0x4d7f96,          // harbour + open ocean; flat, tone-mapping off
  seaDeep: 0x2f5a72,      // the one accent that reads at planet scale
  road: 0x3c3e4c,        // measured: the dominant asphalt tone
  roadLight: 0x555a6b,
  roadPatch: 0x494c58,   // resurfaced patches — the variation that stops the
  roadDamp: 0x353844,    // carriageway reading as one flat tone
  kerbPaint: 0xf2c33c,   // the yellow half of black-and-yellow kerbs
  kerbDark: 0x1e1c22,
  zebra: 0xf4efe2,
  footpath: 0xb9ad96,
  ballast: 0x8a8177,
  sleeper: 0x6d5f4e,
  rail: 0x9aa0a6,
  platform: 0xcdc0a6,
  platformEdge: 0xe8dfc9,
  ramp: 0xbfb49c,

  // ---- railway ----------------------------------------------------------
  trainRed: 0xc0392b,    // Western Railway coach body
  trainCream: 0xf2e6d2,   // upper body
  trainStripe: 0x8e2a20,  // waistline
  trainRoof: 0xb9b2a4,
  trainWindow: 0x33405a,
  wrGreen: 0x2f6b52,      // Indian Railways green on steel
  wrGreenDark: 0x22503d,
  canopyRoof: 0xe6dcc6,
  canopyUnder: 0x9a9384,
  steel: 0x4d5a63,        // neutral structural steel, distinct from WR green
  timber: 0x7d613f,       // platform benches
  signalRed: 0xd23b2a,
  signalGreen: 0x3faa5c,

  // ---- vehicles ---------------------------------------------------------
  taxiBlack: 0x17161b,
  taxiYellow: 0xf0b429,
  // A first-class vehicle white, and the hedge greens, promoted out of
  // src/geo/street.ts's private C table (2026-09-30). The prop kit wanted both
  // and borrowing road-marking white for a car body was a semantic hack; if a
  // colour is needed by two systems it belongs here.
  carWhite: 0xece7dc,
  carSilver: 0xa8adb4,
  autoRed: 0xb8392c,
  autoYellow: 0xe8b62c,
  glassTint: 0x6b7c96,

  // ---- buildings --------------------------------------------------------
  chawl: 0xd9c3a2,       // weathered plaster
  chawlAlt: 0xc7a98a,
  chawlShade: 0xa88a6d,
  midrise: 0xcfb9a0,
  tower: 0xd6cdbe,
  towerGlass: 0x7d8b9c,
  concrete: 0xbdb3a2,
  balcony: 0x8f6f52,

  // ---- rooftop clutter (the reference build has none of this) ----------
  tank: 0x4a5b52,        // black/green poly water tanks
  tankBlue: 0x3d5a72,
  tarpaulin: 0x2f6f86,   // the blue tarps that define a Mumbai roofline
  tarpaulinAlt: 0x4a7f8c,
  laundry: 0xf2ede0,
  laundryAlt: 0xe8c9b0,
  dish: 0xd8d4cc,        // dish antennas
  brick: 0xa9613f,       // exposed brick and laterite

  // ---- nature -----------------------------------------------------------
  hedge: 0x4f7a44,
  hedgeLight: 0x6a9a58,
  gulmohar: 0xd8452c,    // flame-of-the-forest blossom
  gulmoharDeep: 0xa82d1c,
  gulmoharLeaf: 0x3f6b3a,
  trunk: 0x5a4433,

  // ---- people -----------------------------------------------------------
  skin: 0xa9714a,
  skinDeep: 0x8a5734,
  hair: 0x241c17,
  sari: 0xd94f6a,        // the saturated accents that pop against grey city
  sariAlt: 0x2f9fa8,
  sariWarm: 0xe0a03c,
  kurta: 0xf0ead9,
  shirt: 0x9db4d0,
  trousers: 0x3a3f4c,

  // ---- signage ----------------------------------------------------------
  signRed: 0xc23a2c,     // station fascia
  signGreen: 0x2e7d4f,   // platform boards
  signBlue: 0x2b5f9e,    // directional + footbridge
  signAmber: 0xe8a020,   // LED departure board
  signWhite: 0xf7f2e6,
};

/** The palette as a flat array of hex numbers, for the assert self-check. */
export const LIVERY_CHECK = {
  trainRed: PAL.trainRed,
  trainCream: PAL.trainCream,
  wrGreen: PAL.wrGreen,
  taxiBlack: PAL.taxiBlack,
  taxiYellow: PAL.taxiYellow,
  kerbPaint: PAL.kerbPaint,
};
