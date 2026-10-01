/**
 * Landmark registry: the buildings of Mumbai the renderer gives a hand-built
 * silhouette instead of an extruded prism.
 *
 * The coordinates below are researched public facts — Wikipedia/Wikidata
 * infobox coordinates, UNESCO World Heritage listings, and OpenStreetMap
 * Nominatim lookups. They are NOT OSM-derived building footprints; the OSM
 * footprints arrive separately through the ingest pipeline, and this list only
 * says "the famous one here gets this massing and this palette".
 *
 * Every coordinate in here was looked up and checked against its neighbourhood.
 * Do not add an entry by eye. An invented coordinate puts a landmark in the sea
 * or ten kilometres inland, and that is the exact failure this project already
 * suffered once (see the header note in places.ts, where `fort` landed in the
 * Mahim creek). A building whose position cannot be sourced is left out until
 * someone sources it — a short correct list beats a long wrong one.
 *
 * Heights are metres. Where a published figure exists it is used and rounded;
 * otherwise the value is a plain architectural estimate for a storey count and
 * is not meant to look like a survey.
 */

export type Tier = 0 | 1 | 2 | 3;

export interface Landmark {
  /** stable lowercase id, unique */
  id: string;
  /** the real name, e.g. "Chhatrapati Shivaji Maharaj Terminus" */
  name: string;
  /** Devanagari name, or null if you are not confident of the spelling */
  nameDeva: string | null;
  lon: number;
  lat: number;
  /**
   * 0 = ordinary building, no special treatment
   * 1 = recognisable silhouette (custom massing/shape, generic detail)
   * 2 = named architectural building (custom roof + facade family + palette)
   * 3 = hero landmark (custom silhouette + palette + roof + accent geometry)
   */
  tier: Tier;
  /** one of the family ids below — drives the base grammar */
  family: string;
  /** a named palette id below */
  palette: string;
  /** a roof id below */
  roof: string;
  /** approximate height in metres; use a real published figure where one exists */
  heightM: number;
  /** 1..10, how much this building anchors the skyline */
  importance: number;
  /** short English line for the QA overlay */
  note: string;
}

export const LANDMARKS: Landmark[] = [
  // ---------------------------------------------------------------- Colaba
  {
    id: "gateway-of-india",
    name: "Gateway of India",
    nameDeva: "भारताचा द्वार",
    lon: 72.8347,
    lat: 18.922,
    tier: 3,
    family: "victorian_institutional",
    palette: "colonial_stone",
    roof: "spire",
    heightM: 26,
    importance: 10,
    note: "Indo-Saracenic dome over a colonnaded basalt arch",
  },
  {
    id: "taj-mahal-palace-hotel",
    name: "Taj Mahal Palace Hotel",
    nameDeva: "ताज महल पॅलेस होटेल",
    lon: 72.8333,
    lat: 18.922,
    tier: 3,
    family: "hotel",
    palette: "plaster_warm",
    roof: "dome",
    heightM: 24,
    importance: 9,
    note: "Dome turret over a colonnaded seafront wing",
  },
  {
    id: "royal-bombay-yacht-club",
    name: "Royal Bombay Yacht Club",
    nameDeva: null,
    lon: 72.8333,
    lat: 18.9234,
    tier: 2,
    family: "colonial_commercial",
    palette: "colonial_stone",
    roof: "flat_parapet",
    heightM: 16,
    importance: 7,
    note: "Colonnaded club front with a clock tower over the harbour",
  },
  {
    id: "cathedral-of-the-holy-name",
    name: "Cathedral of the Holy Name",
    nameDeva: null,
    lon: 72.8306,
    lat: 18.9234,
    tier: 1,
    family: "religious",
    palette: "colonial_stone",
    roof: "pitched_tile",
    heightM: 25,
    importance: 4,
    note: "Gabled nave front with a large rose window",
  },
  {
    id: "wellington-fountain",
    name: "Wellington Fountain",
    nameDeva: null,
    lon: 72.8324,
    lat: 18.9255,
    tier: 1,
    family: "victorian_institutional",
    palette: "colonial_stone",
    roof: "spire",
    heightM: 9,
    importance: 4,
    note: "Cast-iron column carrying a winged victory figure",
  },
  {
    id: "maharashtra-police-hq",
    name: "Maharashtra Police Headquarters",
    nameDeva: null,
    lon: 72.8333,
    lat: 18.9253,
    tier: 2,
    family: "victorian_institutional",
    palette: "colonial_stone",
    roof: "pitched_tile",
    heightM: 26,
    importance: 7,
    note: "Venetian Gothic gables facing the Wellington Fountain",
  },

  // ------------------------------------------------------- Kala Ghoda / Fort
  {
    id: "chhatrapati-shivaji-maharaj-terminus",
    name: "Chhatrapati Shivaji Maharaj Terminus",
    nameDeva: "छत्रपती शिवाजी महाराज टर्मिनस",
    lon: 72.8355,
    lat: 18.9398,
    tier: 3,
    family: "victorian_institutional",
    palette: "colonial_stone",
    roof: "pitched_tile",
    heightM: 44,
    importance: 10,
    note: "Ribbed central dome over turrets flanking a long arcaded front",
  },
  {
    id: "reserve-bank-of-india",
    name: "Reserve Bank of India",
    nameDeva: "भारतीय रिझर्व्ह बँक",
    lon: 72.8369,
    lat: 18.9328,
    tier: 2,
    family: "colonial_commercial",
    palette: "institutional_stone",
    roof: "flat_parapet",
    heightM: 24,
    importance: 7,
    note: "Interwar classical bank behind a long colonnaded loggia",
  },
  {
    id: "bombay-high-court",
    name: "Bombay High Court",
    nameDeva: "मुंबई उच्च न्यायालय",
    lon: 72.8305,
    lat: 18.9312,
    tier: 2,
    family: "victorian_institutional",
    palette: "institutional_stone",
    roof: "dome",
    heightM: 28,
    importance: 8,
    note: "Gothic turrets and domed pavilions over a colonnaded block",
  },
  {
    id: "flora-fountain",
    name: "Flora Fountain",
    nameDeva: null,
    lon: 72.8317,
    lat: 18.9325,
    tier: 2,
    family: "victorian_institutional",
    palette: "colonial_stone",
    roof: "spire",
    heightM: 11,
    importance: 7,
    note: "Ornate columnar drum carrying a winged figure under a canopy",
  },
  {
    id: "esplanade-house",
    name: "Esplanade House",
    nameDeva: null,
    lon: 72.8314,
    lat: 18.9359,
    tier: 2,
    family: "victorian_institutional",
    palette: "colonial_stone",
    roof: "mansard",
    heightM: 22,
    importance: 7,
    note: "Neoclassical portico under a mansard roof with balustrade",
  },
  {
    id: "convocation-hall-university-of-mumbai",
    name: "University of Mumbai Convocation Hall",
    nameDeva: "कव्वाजी जहांगीर समारंभ मंडप",
    lon: 72.83,
    lat: 18.9298,
    tier: 2,
    family: "victorian_institutional",
    palette: "colonial_stone",
    roof: "spire",
    heightM: 24,
    importance: 7,
    note: "Pointed arcade under a steep gable with corner pinnacles",
  },
  {
    id: "rajabai-clock-tower",
    name: "Rajabai Clock Tower",
    nameDeva: "राजाबाई घड्याळ टॉवर",
    lon: 72.830,
    lat: 18.9297,
    tier: 3,
    family: "victorian_institutional",
    palette: "colonial_stone",
    roof: "spire",
    heightM: 76,
    importance: 9,
    note: "Slender Venetian-Gothic campanile with a belfry and needle spire",
  },
  {
    id: "david-sassoon-library",
    name: "David Sassoon Library",
    nameDeva: null,
    lon: 72.8311,
    lat: 18.928,
    tier: 2,
    family: "victorian_institutional",
    palette: "colonial_stone",
    roof: "pitched_tile",
    heightM: 19,
    importance: 7,
    note: "Venetian Gothic reading room under a steep tiled roof",
  },
  {
    id: "chhatrapati-shivaji-maharaj-vastu-sangrahalaya",
    name: "Chhatrapati Shivaji Maharaj Vastu Sangrahalaya",
    nameDeva: null,
    lon: 72.8327,
    lat: 18.9269,
    tier: 2,
    family: "victorian_institutional",
    palette: "colonial_stone",
    roof: "dome",
    heightM: 29,
    importance: 7,
    note: "Long Indo-Saracenic facade under a striped central dome",
  },
  {
    id: "jehangir-art-gallery",
    name: "Jahangir Art Gallery",
    nameDeva: null,
    lon: 72.8317,
    lat: 18.9275,
    tier: 1,
    family: "colonial_commercial",
    palette: "colonial_stone",
    roof: "mansard",
    heightM: 15,
    importance: 4,
    note: "Renaissance palazzo front with a heavy bracketed cornice",
  },
  {
    id: "cowasji-jehangir-public-hall",
    name: "Cowasji Jehangir Public Hall",
    nameDeva: null,
    lon: 72.8313,
    lat: 18.9258,
    tier: 1,
    family: "institutional_campus",
    palette: "colonial_stone",
    roof: "flat_parapet",
    heightM: 15,
    importance: 4,
    note: "Neoclassical hall with a pedimented arcaded front",
  },
  {
    id: "bombay-stock-exchange",
    name: "Bombay Stock Exchange",
    nameDeva: null,
    lon: 72.8334,
    lat: 18.9299,
    tier: 2,
    family: "art_deco_apartment",
    palette: "art_deco_cream",
    roof: "flat_parapet",
    heightM: 24,
    importance: 7,
    note: "Striped marble tower rising from a colonnaded Art Deco base",
  },
  {
    id: "regal-cinema",
    name: "Regal Cinema",
    nameDeva: null,
    lon: 72.8325,
    lat: 18.9246,
    tier: 2,
    family: "art_deco_apartment",
    palette: "art_deco_cream",
    roof: "flat_parapet",
    heightM: 21,
    importance: 7,
    note: "Rounded corner bay above a vertical fin facade",
  },
  {
    id: "metro-cinema",
    name: "Metro Cinema",
    nameDeva: null,
    lon: 72.8288,
    lat: 18.9429,
    tier: 2,
    family: "art_deco_apartment",
    palette: "art_deco_cream",
    roof: "flat_parapet",
    heightM: 19,
    importance: 6,
    note: "Streamlined deco front with a curved central canopy",
  },
  {
    id: "st-thomas-cathedral",
    name: "St Thomas Cathedral",
    nameDeva: null,
    lon: 72.8337,
    lat: 18.9319,
    tier: 2,
    family: "religious",
    palette: "colonial_stone",
    roof: "spire",
    heightM: 30,
    importance: 7,
    note: "Tall nave with corner pinnacles on an open green",
  },
  {
    id: "general-post-office-mumbai",
    name: "General Post Office, Mumbai",
    nameDeva: null,
    lon: 72.8344,
    lat: 18.94,
    tier: 1,
    family: "institutional_campus",
    palette: "concrete_grey",
    roof: "flat_parapet",
    heightM: 35,
    importance: 4,
    note: "Tall post office slab behind a colonnaded entrance loggia",
  },
  {
    id: "bombay-gymkhana",
    name: "Bombay Gymkhana",
    nameDeva: null,
    lon: 72.8311,
    lat: 18.9371,
    tier: 1,
    family: "institutional_campus",
    palette: "colonial_stone",
    roof: "pitched_tile",
    heightM: 16,
    importance: 4,
    note: "Low colonial clubhouse with a deep shaded verandah",
  },
  {
    id: "mantralaya",
    name: "Mantralaya",
    nameDeva: null,
    lon: 72.827,
    lat: 18.9277,
    tier: 2,
    family: "modern_tower",
    palette: "concrete_grey",
    roof: "setback",
    heightM: 78,
    importance: 6,
    note: "Stepped government slab with service towers on the flanks",
  },

  // ------------------------------------------------------ Nariman Point / Cuffe
  {
    id: "air-india-building",
    name: "Air India Building",
    nameDeva: null,
    lon: 72.822,
    lat: 18.9305,
    tier: 2,
    family: "colonial_commercial",
    palette: "institutional_stone",
    roof: "flat_parapet",
    heightM: 27,
    importance: 6,
    note: "Interwar office block with a curved glass entrance bay",
  },
  {
    id: "express-towers",
    name: "Express Towers",
    nameDeva: null,
    lon: 72.8222,
    lat: 18.9282,
    tier: 2,
    family: "modern_tower",
    palette: "concrete_grey",
    roof: "flat_parapet",
    heightM: 75,
    importance: 6,
    note: "Plain slab tower with a service block lifted on two cores",
  },
  {
    id: "the-oberoi-nariman-point",
    name: "The Oberoi, Nariman Point",
    nameDeva: null,
    lon: 72.8206,
    lat: 18.927,
    tier: 2,
    family: "hotel",
    palette: "modern_glass",
    roof: "flat_parapet",
    heightM: 33,
    importance: 7,
    note: "Glazed slab over a stepped podium with a scalloped canopy",
  },
  {
    id: "ncpa-nariman-point",
    name: "National Centre for the Performing Arts",
    nameDeva: null,
    lon: 72.8199,
    lat: 18.9252,
    tier: 1,
    family: "institutional_campus",
    palette: "concrete_grey",
    roof: "flat_parapet",
    heightM: 15,
    importance: 4,
    note: "Low terraced theatre massing under a stepped garden roof",
  },
  {
    id: "crawford-market",
    name: "Crawford Market",
    nameDeva: null,
    lon: 72.8347,
    lat: 18.9474,
    tier: 2,
    family: "market_shed",
    palette: "brick_laterite",
    roof: "pitched_tile",
    heightM: 14,
    importance: 7,
    note: "Corrugated gable sheds under a long flanking arcade",
  },

  // -------------------------------------------------- Malabar Hill / Girgaon
  {
    id: "royal-opera-house",
    name: "Royal Opera House",
    nameDeva: null,
    lon: 72.8156,
    lat: 18.9561,
    tier: 2,
    family: "colonial_commercial",
    palette: "plaster_warm",
    roof: "flat_parapet",
    heightM: 21,
    importance: 7,
    note: "Baroque opera front with a curved pediment and column pairs",
  },
  {
    id: "babulnath-temple",
    name: "Babulnath Temple",
    nameDeva: null,
    lon: 72.8086,
    lat: 18.9587,
    tier: 1,
    family: "religious",
    palette: "plaster_warm",
    roof: "spire",
    heightM: 20,
    importance: 4,
    note: "Shikhara spire above a plain plastered mandapa block",
  },
  {
    id: "mani-bhavan",
    name: "Mani Bhavan",
    nameDeva: null,
    lon: 72.8115,
    lat: 18.9599,
    tier: 1,
    family: "bungalow",
    palette: "plaster_pink",
    roof: "pitched_tile",
    heightM: 12,
    importance: 4,
    note: "Pink bungalow with a wide hipped roof and shaded verandah",
  },
  {
    id: "taraporewala-aquarium",
    name: "Taraporewala Aquarium",
    nameDeva: null,
    lon: 72.8201,
    lat: 18.9493,
    tier: 1,
    family: "colonial_commercial",
    palette: "colonial_stone",
    roof: "flat_parapet",
    heightM: 15,
    importance: 4,
    note: "Narrow ribbed facade with a banded cornice over Marine Drive",
  },
  {
    id: "haji-ali-dargah",
    name: "Haji Ali Dargah",
    nameDeva: null,
    lon: 72.81,
    lat: 18.985,
    tier: 3,
    family: "religious",
    palette: "institutional_stone",
    roof: "dome",
    heightM: 15,
    importance: 9,
    note: "Bulbous white dome over an arcaded shoreline shrine",
  },

  // ------------------------------------------------------------------ Worli
  {
    id: "nehru-planetorium",
    name: "Nehru Planetarium",
    nameDeva: null,
    lon: 72.8139,
    lat: 18.9884,
    tier: 2,
    family: "institutional_campus",
    palette: "concrete_grey",
    roof: "dome",
    heightM: 23,
    importance: 7,
    note: "Shallow dome on a stepped drum above a seafront esplanade",
  },

  // ------------------------------------------------------------------ Dadar
  {
    id: "siddhivinayak-temple",
    name: "Siddhivinayak Temple",
    nameDeva: "सिद्धिविनायक मंदिर",
    lon: 72.8306,
    lat: 19.016,
    tier: 2,
    family: "religious",
    palette: "plaster_pink",
    roof: "dome",
    heightM: 20,
    importance: 7,
    note: "Rounded dome and finial over a tiered square plinth",
  },

  // ----------------------------------------------------------------- Bandra
  {
    id: "bandra-fort",
    name: "Bandra Fort",
    nameDeva: null,
    lon: 72.8186,
    lat: 19.0421,
    tier: 1,
    family: "victorian_institutional",
    palette: "concrete_grey",
    roof: "flat_parapet",
    heightM: 12,
    importance: 4,
    note: "Sea-facing rampart wall cut into the Bandra headland",
  },
  {
    id: "mount-mary-basilica",
    name: "Basilica of Our Lady of the Mount",
    nameDeva: null,
    lon: 72.8225,
    lat: 19.0467,
    tier: 2,
    family: "religious",
    palette: "institutional_stone",
    roof: "pitched_tile",
    heightM: 30,
    importance: 8,
    note: "Twin spires flanking a banded yellow basilica front",
  },
  {
    id: "mount-mary-steps",
    name: "Mount Mary Steps",
    nameDeva: null,
    lon: 72.8251,
    lat: 19.0482,
    tier: 1,
    family: "religious",
    palette: "concrete_grey",
    roof: "flat_parapet",
    heightM: 12,
    importance: 5,
    note: "Terraced flight of steps climbing a cliff above the sea",
  },
  {
    id: "st-andrews-church-khar",
    name: "St Andrew's Church, Khar",
    nameDeva: null,
    lon: 72.8259,
    lat: 19.0546,
    tier: 2,
    family: "religious",
    palette: "colonial_stone",
    roof: "spire",
    heightM: 30,
    importance: 6,
    note: "Gothic nave with a square bell tower and corner pinnacles",
  },
  {
    id: "one-bkc",
    name: "One BKC",
    nameDeva: null,
    lon: 72.865,
    lat: 19.0606,
    tier: 2,
    family: "modern_tower",
    palette: "modern_glass",
    roof: "setback",
    heightM: 307,
    importance: 7,
    note: "Crowned glass tower over a stepped business-park podium",
  },

  // ------------------------------------------------------------- Juhu/Andheri
  {
    id: "sea-princess-hotel",
    name: "Hotel Sea Princess",
    nameDeva: null,
    lon: 72.8278,
    lat: 19.0932,
    tier: 2,
    family: "hotel",
    palette: "concrete_grey",
    roof: "flat_parapet",
    heightM: 38,
    importance: 7,
    note: "Stepped balcony stack over a curved seafront base",
  },
  {
    id: "hilton-mumbai-andheri",
    name: "Hilton Mumbai",
    nameDeva: null,
    lon: 72.8709,
    lat: 19.1044,
    tier: 2,
    family: "hotel",
    palette: "concrete_grey",
    roof: "flat_parapet",
    heightM: 25,
    importance: 6,
    note: "Wide hotel slab with a recessed balcony grid and podium",
  },
  {
    id: "hiranandani-gardens",
    name: "Hiranandani Gardens",
    nameDeva: null,
    lon: 72.9115,
    lat: 19.1184,
    tier: 1,
    family: "mixed_use",
    palette: "plaster_warm",
    roof: "mansard",
    heightM: 18,
    importance: 4,
    note: "Neo-classical blocks with colonnaded podiums and pitched roofs",
  },
];

export const LANDMARK_BY_ID: Map<string, Landmark> = new Map(
  LANDMARKS.map((landmark) => [landmark.id, landmark]),
);

/** Metres per degree at the equator; longitude is scaled by cos(latitude). */
const M_PER_DEG_LAT = 111_320;

/**
 * Nearest landmark to a WGS84 point, or null when nothing is within `maxM`.
 *
 * Flat-earth approximation over a city's worth of distance — the error at
 * a few hundred metres is far below what the landmark points mean.
 *
 * @param lon longitude of the query point, degrees
 * @param lat latitude of the query point, degrees
 * @param maxM search radius in metres
 * @returns the closest landmark within the radius, or null
 */
export function landmarkNear(lon: number, lat: number, maxM = 250): Landmark | null {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best: Landmark | null = null;
  let bestD2 = Infinity;

  for (const landmark of LANDMARKS) {
    const dLon = (landmark.lon - lon) * cosLat;
    const dLat = landmark.lat - lat;
    const d2 = dLon * dLon + dLat * dLat;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = landmark;
    }
  }

  if (!best) return null;
  const metres = Math.sqrt(bestD2) * M_PER_DEG_LAT;
  return metres <= maxM ? best : null;
}
