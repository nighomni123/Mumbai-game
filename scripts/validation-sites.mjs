#!/usr/bin/env node
/**
 * GROUND-TRUTH VALIDATION SITES FOR THE GREATER MUMBAI 3D MODEL.
 * ==============================================================
 *
 * `VALIDATION_SITES` is a set of fixed, machine-checkable reference points for
 * validating the rendered 3D model of Greater Mumbai against the real city,
 * BEFORE any visual optimisation. A validator takes each site's WGS84
 * coordinate, looks at what the model draws within the stated tolerance, and
 * asserts the `expect` block:
 *
 *   - `landmarks`          real named places that must exist within ~400 m
 *   - `rail`               is a Mumbai Suburban Railway / Central line station
 *                          within ~1 km
 *   - `metroOrMonorail`    is a Mumbai Metro or Mumbai Monorail station within
 *                          ~1 km
 *   - `water`              "none" | "coast" | "creek" | "lake" — the water body
 *                          within ~600 m of the point
 *   - `majorRoadExamples`  real named major roads that must pass within ~500 m
 *
 * One key is ADDED to the entry shape beyond `id/name/lon/lat/district/expect`:
 * `covers: ["Fort", "Colaba"]` — which of `REQUIRED_AREAS` this site proves.
 * It makes the coverage contract machine-checkable instead of prose; ignore it
 * and every required field is exactly as specified.
 *
 * COORDINATES ARE WGS84 (EPSG:4326), degrees, longitude first in every source
 * dataset — `lon` then `lat`, exactly as given. Keep it that way: the geo
 * pipeline in `scripts/geo.mjs` stores source data in WGS84 and only projects
 * into a local metric frame at render time, so the manifest stays comparable
 * with whatever the model ingests.
 *
 * COVERAGE: 36 sites across the whole metro, not just South Mumbai — Fort,
 * Colaba, Churchgate, Charni Road, Marine Drive, Parel, Worli, Dadar, Wadala /
 * Bandra (East + West), Khar, Santacruz, Vile Parle, Andheri, Juhu,
 * Jogeshwari, Goregaon, Malad (West + East), Kandivali, Borivali, Dahisar
 * (West + East), BKC / Chembur, Ghatkopar, Mulund, Powai, Vikhroli,
 * Kanjurmarg, Bhandup / Thane, CBD Belapur, Vashi.
 *
 * HOW THESE VALUES WERE CHECKED (not recalled):
 *   - `landmarks` and `majorRoadExamples` are named buildings / streets that
 *     the public, OSM-derived MCGM FeatureServer "Mumbai_WFL1" (layers 2
 *     buildings, 1 streets — the same source `scripts/ingest-mumbai.mjs` pulls)
 *     actually returns around the coordinate, with the measured distance
 *     recorded in the comment above each entry. Admin district is that same
 *     layer's `districtname` field (it returns "Mumbai" for the island city,
 *     "Mumbai Suburban", and "Thane").
 *   - `rail` / `metroOrMonorail` are cross-checked against the OSM railway
 *     station layer (Overpass) and the Wikipedia operational/under-construction
 *     station lists for Mumbai Metro and Mumbai Monorail.
 *
 * TWO HONEST CAVEATS, kept here rather than buried:
 *   1. `district` takes a THIRD value, "Thane", for Thane and Navi Mumbai.
 *      Since 2020 Navi Mumbai is part of Thane district, and the LGD district
 *      name in the source data is literally "Thane" — labelling Belapur or
 *      Thane as "Mumbai City" or "Mumbai Suburban" would be a false claim in
 *      a file whose whole job is to be true. To go back to a two-value enum,
 *      change the 3 sites listed in `THANE_DISTRICT_SITES` below.
 *   2. `metroOrMonorail` is SPATIAL, not commercial: it means a station
 *      structure sits within ~1 km. The Mumbai Monorail has been suspended
 *      since 20 September 2025 (upgrades; reopening repeatedly delayed), so a
 *      `true` there is a viaduct/platform truth, not a "trains are running"
 *      claim. Stations still under construction are treated as `false` — e.g.
 *      Bandra, Jogeshwari (West), Bhandup, Kanjurmarg (West), IIT Powai,
 *      Powai Lake, Mulund Naka, Airport Colony and all of Thane's lines.
 *
 * SITES THAT SIT ON THE 1 km / 600 m TOLERANCE EDGE (measured, flagged so a
 * validator does not mistake a boundary call for a bug):
 *   juhu          Versova metro is 0.93 km away  -> metroOrMonorail true
 *   fort          CSMT rail 0.84 km, Hutatma Chowk metro 0.25 km
 *   dahisar       Mandapeshwar metro ~0.99 km   -> metroOrMonorail true
 *   borivali      Rashtriya Udyan metro 0.89 km -> metroOrMonorail true
 *   malad         Malad West metro 0.65 km     -> metroOrMonorail true
 *   malad-east    Kurar metro 0.68 km, nearest rail 0.94 km -> rail false
 *   dahisar-east  Dahisar rail 0.71 km
 *   marine-drive  Churchgate rail 0.70 km; the Marine Drive promenade itself is
 *                 ~100 m inland at this point
 *
 * Run:  node scripts/validation-sites.mjs
 * Prints one line per site, the totals, and runs `checkManifest()` — the same
 * shape/coverage assertions a consumer would want (unique ids, WGS84 sanity,
 * non-empty landmark and road lists, valid district and water enums, >= 22
 * sites, every required area covered). It exits non-zero if any fail, so it
 * doubles as the one runnable check for this file.
 * Plain ES module (`.mjs`), no dependencies, no build step. Also usable as an
 * import: `import { VALIDATION_SITES } from "./scripts/validation-sites.mjs"`.
 */
import { pathToFileURL } from "node:url";

/** Thane-district sites — the only entries that break a two-value district enum. */
export const THANE_DISTRICT_SITES = ["thane", "belapur", "vashi"];

/** The coverage this manifest is contractually required to provide. */
export const REQUIRED_AREAS = [
  "Fort", "Colaba", "Dadar", "Parel", "Worli", "Bandra", "Andheri", "Juhu",
  "Santacruz", "Vile Parle", "Malad", "Kandivali", "Borivali", "Dahisar",
  "Chembur", "Wadala", "Ghatkopar", "Mulund", "Bhandup", "Powai", "Vikhroli",
  "Kanjurmarg", "Thane", "Navi Mumbai",
];

export const VALIDATION_SITES = [
  /* --- South Mumbai: the island city (BMC) ------------------------------- */
  {
    id: "gateway-of-india",
    name: "Gateway of India, Nariman Point",
    lon: 72.8347, lat: 18.9220,
    district: "Mumbai City",
    covers: ["Fort", "Colaba"],
    expect: {
      // GOI 15 m, Taj 118 m, DAE 169 m, RBYC 223 m, Police HQ 338 m, Regal Cinema 350 m.
      landmarks: ["Gateway of India", "Taj Mahal Palace Hotel", "Department of Atomic Energy", "Royal Bombay Yacht Club", "Maharashtra Police Headquarters", "Regal Cinema"],
      rail: false,               // nearest WR station is CSMT, ~1.2 km
      metroOrMonorail: false,    // nearest is Vidhan Bhavan (Line 3), 1.02 km
      water: "coast",            // the monument stands on the Back Bay waterfront
      majorRoadExamples: ["Madam Cama Road", "Shahid Bhagat Singh Road", "Maharshi Karve Road", "Mahatma Gandhi Marg", "General Bhonsle Marg"],
    },
  },
  {
    id: "fort",
    name: "Fort, Mumbai CSMT",
    lon: 72.8345, lat: 18.9330,
    district: "Mumbai City",
    covers: ["Fort"],
    expect: {
      // CSMT 182 m, MCGM 160 m, Times of India 138 m, St Thomas Cathedral 139 m,
      // Banaji Limji Agiary 160 m, Asiatic Society Town Hall 229 m, Readymoney
      // Mansion 229 m, Bombay Fort Wall Remnant 356 m.
      landmarks: ["Chhatrapati Shivaji Maharaj Terminus (Mumbai CSMT)", "Municipal Corporation of Greater Mumbai", "Times of India Building", "St Thomas Cathedral", "Banaji Limji Agiary", "Asiatic Society Town Hall", "Readymoney Mansion", "Bombay Fort Wall Remnant"],
      rail: true,                // Mumbai CSMT 0.84 km
      metroOrMonorail: true,     // Hutatma Chowk (Line 3) 0.25 km, CSMT 0.91 km
      water: "coast",            // Mumbai Harbour ~0.6 km east
      majorRoadExamples: ["P D Mello Road", "Sir Jamshedji Jeejeebhoy Road", "Mahatma Gandhi Marg", "Maharshi Karve Marg", "Walchand Hirachand Road", "Mint Road", "Perin Nariman Street"],
    },
  },
  {
    id: "colaba",
    name: "Colaba Causeway, Sassoon Dock",
    lon: 72.8245, lat: 18.9135,
    district: "Mumbai City",
    covers: ["Colaba"],
    expect: {
      // MBPT fish market 76 m, Sassoon Dock gate 95 m, Dunne Institute 224 m,
      // Institute of Chartered Accountants 247 m, Colaba Fire Station 277 m,
      // Parsee Sanitorium 305 m.
      landmarks: ["MBPT Colaba Fish Market", "Sassoon Dock Gate No 1", "Dunne Institute", "The Institute of Chartered Accountants of India", "Colaba Fire Station", "Parsi Sanitorium"],
      rail: false,               // no railway on the island south of CSMT
      metroOrMonorail: true,     // Cuffe Parade (Line 3) 0.42 km
      water: "coast",            // the causeway runs over the harbour
      majorRoadExamples: ["Captain Prakash Pethe Marg", "Shahid Bhagat Singh Road", "Woodhouse Road", "G D Somani Marg", "Sadhu T L Waswani Marg", "Dumayne Road"],
    },
  },
  {
    id: "churchgate",
    name: "Churchgate",
    lon: 72.8253, lat: 18.9372,
    district: "Mumbai City",
    covers: ["Fort", "Colaba"],
    expect: {
      // Mumbai Cricket Association 36 m, Krishna Mahal 50 m, Garware Club House
      // 82 m, Keval Mahal 84 m, Zaver Mahal 121 m, Churchgate station 276 m.
      landmarks: ["Mumbai Cricket Association", "Garware Club House", "Keval Mahal", "Krishna Mahal", "Zaver Mahal", "Churchgate railway station"],
      rail: true,                // Western line terminus, 0.28 km
      metroOrMonorail: true,     // Churchgate (Line 3) 0.63 km
      water: "coast",            // Netaji Subhash Marg (Marine Drive) ~0.2 km west
      majorRoadExamples: ["Netaji Subhash Marg", "Maharshi Karve Marg", "Veer Nariman Road", "Sir Vithaldas Thackersey Road", "Mahatma Gandhi Marg", "Baburao Marg"],
    },
  },
  {
    id: "charni-road",
    name: "Charni Road, Grant Road side",
    lon: 72.8182, lat: 18.9518,
    district: "Mumbai City",
    covers: ["Fort"],
    expect: {
      // Government Press 18 m, Jawahar Bal Bhawan 70 m, Saifee Hospital 75 m,
      // Directorate of Government Printing 75 m, St. Teresa High School 185 m,
      // Mumbai Marathi Sahitya Sangh Mandir 216 m, Kaivalyadhama 270 m.
      landmarks: ["Government Press", "Jawahar Bal Bhawan", "Saifee Hospital", "Directorate of Government Printing Stationery and Publication", "St. Teresa High School", "Mumbai Marathi Sahitya Sangh Mandir", "Kaivalyadhama Yoga Centre"],
      rail: true,                // Charni Road station is at this point
      metroOrMonorail: true,     // Girgaon (Line 3) 0.42 km
      water: "coast",            // Marine Drive / Netaji Subhash Marg ~0.4 km west
      majorRoadExamples: ["Netaji Subhash Marg", "Maharshi Karve Marg", "Dharamveer Swarajya Rakshak Chhatrapati Sambhaji Maharaj Marg", "Jagannath Shankarsheth Marg", "Mama Paramanand Marg", "Vitthalbhai Patel Marg"],
    },
  },
  {
    id: "marine-drive",
    name: "Marine Drive, Malabar Hill",
    lon: 72.8240, lat: 18.9300,
    district: "Mumbai City",
    covers: ["Fort", "Colaba"],
    expect: {
      // CCI Club ~250 m, Stadium House ~300 m, Framroz Court ~300 m, Bharat
      // Petroleum ~310 m, St. James Court ~330 m, Hotel Marine Plaza ~360 m.
      landmarks: ["CCI Club", "Stadium House", "Framroz Court", "Bharat Petroleum", "St. James Court", "Hotel Marine Plaza"],
      rail: true,                // Churchgate station 0.70 km
      metroOrMonorail: true,     // Churchgate (Line 3) 0.35 km
      water: "coast",            // the Back Bay promenade is ~100 m west
      majorRoadExamples: ["Netaji Subhash Marg", "Madam Cama Road", "Maharshi Karve Road", "Jamshedji Tata Road", "Veer Nariman Road", "Free Press Journal Marg"],
    },
  },
  {
    id: "parel",
    name: "Parel, mill quarter",
    lon: 72.8410, lat: 18.9900,
    district: "Mumbai City",
    covers: ["Parel"],
    expect: {
      // The "Building Number 22-35" names in the source data are the mill chawl
      // blocks (81-260 m); the OSM-named building "Parel" is 228 m.
      landmarks: ["Parel railway station", "Parel mill chawl blocks (Building Number 22 to Building Number 35)", "Aashirwad Cooperative Housing Society", "Ishwati Prasad CHS"],
      rail: true,                // Western line, Parel station ~0.05 km
      metroOrMonorail: true,     // Mint Colony monorail station 0.55 km
      water: "none",
      majorRoadExamples: ["G D Ambekar Marg", "Barrister Nath Pai Marg", "D P Road", "Dr Babasaheb Ambedkar Road", "Zakeria Bandar Road", "Sant Dnyaneshwar Flyover", "Parel Tank Road"],
    },
  },
  {
    id: "worli",
    name: "Worli",
    lon: 72.8340, lat: 19.0260,
    district: "Mumbai City",
    covers: ["Worli"],
    expect: {
      // Dadar Chowpatty 47 m, Sudhanshu Vihar 302 m, Sane Guruji Vidyalaya 394 m.
      landmarks: ["Dadar Chowpatty", "Sudhanshu Vihar", "Sane Guruji Vidyalaya"],
      rail: true,                // Worli station (Western line) ~0.3 km
      metroOrMonorail: true,     // Dadar (Line 3) 0.60 km
      water: "coast",            // Worli sea face ~0.4 km west
      majorRoadExamples: ["Veer Savarkar Marg", "Gokhale Road", "Ranade Road", "Dr M B Raut Road", "Keluskar Marg South", "S H Parelker Marg", "D S Babrekar Marg"],
    },
  },
  {
    id: "dadar",
    name: "Dadar",
    lon: 72.8422, lat: 19.0180,
    district: "Mumbai City",
    covers: ["Dadar"],
    expect: {
      // Moti Bhavan 103 m, Dadar Avanti 110 m, Pir Baghdadi Masjid 192 m,
      // Chhatrapati Shivaji Municipal Market 206 m, station ticket counter 154 m.
      landmarks: ["Dadar railway station", "Dadar Avanti", "Moti Bhavan", "Pir Baghdadi Masjid", "Chhatrapati Shivaji Municipal Market"],
      rail: true,                // Western line, Dadar station ~0.12 km
      metroOrMonorail: true,     // Dadar (Line 3) 0.70 km
      water: "none",
      majorRoadExamples: ["Senapati Bapat Marg", "Dr Babasaheb Ambedkar Road", "N C Kelkar Marg", "Lakhamshi Nappu Road", "Gokhale Road", "Dada Saheb Phalke Marg", "Lokmanya Tilak Road"],
    },
  },
  {
    id: "wadala",
    name: "Wadala",
    lon: 72.8560, lat: 19.0180,
    district: "Mumbai City",
    covers: ["Wadala"],
    expect: {
      // Our Lady of Dolours Church ~150 m, VJTI hostel ~180 m, Murli Dairy Farm
      // ~230 m, Jain Education Society ~280 m; Wadala Bridge monorail 0.35 km.
      landmarks: ["Our Lady of Dolours Church", "VJTI Hostel", "Murli Dairy Farm", "Jain Education Society", "Dadar Parsee Youth Assembly High School"],
      rail: true,                // Wadala Road station ~0.45 km
      metroOrMonorail: true,     // Wadala Bridge monorail 0.35 km (suspended since 2025)
      water: "none",
      majorRoadExamples: ["Rafi Ahmed Kidwai Road", "Katrak Road", "Kidwani Road", "Shivdi Wadala Road", "Lady Jehangir Road", "Nathalal Parekh Road", "David S Barretto Road", "Balaram Babu Khedekar Road"],
    },
  },

  /* --- Western suburbs: the Western line corridor ------------------------ */
  {
    id: "bandra",
    name: "Bandra, station and market",
    lon: 72.8370, lat: 19.0546,
    district: "Mumbai Suburban",
    covers: ["Bandra"],
    expect: {
      // National Library 103 m, Bandra Police Station 181 m, Tata Agiary 246 m,
      // Bandra Railway Police Station 330 m, Bandra Post Office 386 m.
      landmarks: ["Bandra railway station", "National Library", "Bandra Police Station", "Tata Agiary", "Bandra Railway Police Station", "Bandra Post Office"],
      rail: true,                // Western line, Bandra station ~0.2 km
      metroOrMonorail: false,    // Bandra metro (Line 2B) is under construction
      water: "none",
      majorRoadExamples: ["Swami Vivekanand Marg", "Western Express Highway", "Krishna Chandra Road", "Anant Kanekar Road", "Ramdas Nayak Road", "Bandra Reclamation Flyover", "Guru Nanak Marg"],
    },
  },
  {
    id: "bandra-west",
    name: "Bandra West, Hill Road",
    lon: 72.8302, lat: 19.0596,
    district: "Mumbai Suburban",
    covers: ["Bandra"],
    expect: {
      // Busheri Bungalow 86 m, Maker Mahal 87 m, Stella Maris 89 m, Nav
      // Sonarbala Annexe 126 m, Rustomjee Buena Vista 186 m, Red Gates 173 m.
      landmarks: ["Maker Mahal", "Busheri Bungalow", "Stella Maris", "Nav Sonarbala Annexe", "Rustomjee Buena Vista", "Red Gates", "St. Andrew's Church (St Andrews Road)", "St. Theresa's Church (St Theresa Road)"],
      rail: false,               // Bandra station is 1.2 km away, on the other side of the hill
      metroOrMonorail: false,    // BKC metro 2.6 km away
      water: "none",             // the sea is ~1.2 km west
      majorRoadExamples: ["Hill Road", "16th Road", "Dr Babasaheb Ambedkar Road", "Pali Mala Road", "Ramdas Nayak Road", "St Andrews Road", "St Theresa Road", "29th Road", "Master Vinayak Road", "Vithalbhai Patel Road"],
    },
  },
  {
    id: "khar",
    name: "Khar Road",
    lon: 72.8380, lat: 19.0980,
    district: "Mumbai Suburban",
    covers: ["Bandra"],
    expect: {
      // Pawan Hans Hangar 338 m. Named-building coverage is thin here; the
      // station (Western line) is ~0.6-0.8 km NE.
      landmarks: ["Khar Road railway station", "Pawan Hans Hangar"],
      rail: true,
      metroOrMonorail: false,    // no operating metro station within 1 km
      water: "none",             // Khar Danda beach is ~0.8 km west
      majorRoadExamples: ["Swami Vivekanand Marg", "Vaikunthlal Mehta Road", "Sarojini Road", "Sardar Vallabhbhai Patel Road", "Bajaj Road", "S V Road", "Western Express Highway", "P V Avasare Marg"],
    },
  },
  {
    id: "santacruz",
    name: "Santacruz",
    lon: 72.8416, lat: 19.0810,
    district: "Mumbai Suburban",
    covers: ["Santacruz"],
    expect: {
      // Mani Kunj 302 m, Sompuri Market 305 m, Hotel Radhakrishna 308 m, Bhoomi
      // Tower 319 m, Santa Cruz Library 389 m; station 0.06 km.
      landmarks: ["Santa Cruz railway station", "Santa Cruz Library", "Sompuri Market", "Hotel Radhakrishna", "Bhoomi Tower", "Mani Kunj and Sneh Kunj"],
      rail: true,                // Western line, Santa Cruz station ~0.06 km
      metroOrMonorail: true,     // Santacruz (Line 3) 0.64 km
      water: "none",
      majorRoadExamples: ["Swami Vivekanand Marg", "Station Road", "7th Road", "Tagore Road", "Lokmanya Tilak Road", "S V Road", "Western Express Highway", "Vithalbhai Patel Road"],
    },
  },
  {
    id: "vile-parle",
    name: "Vile Parle",
    lon: 72.8404, lat: 19.0979,
    district: "Mumbai Suburban",
    covers: ["Vile Parle"],
    expect: {
      // Navabharat Villa 182 m; Vile Parle station ~0.3-0.45 km.
      landmarks: ["Vile Parle railway station", "Navabharat Villa"],
      rail: true,
      metroOrMonorail: false,    // Airport Colony (Line 7) / Indira Nagar (Line 2B) are under construction
      water: "none",
      majorRoadExamples: ["Swami Vivekanand Marg", "Vaikunthlal Mehta Road", "Sardar Vallabhbhai Patel Road", "Sarojini Road", "Air India Road", "Bajaj Road", "St.Francis Road", "Western Express Highway"],
    },
  },
  {
    id: "andheri",
    name: "Andheri, station and MIDC",
    lon: 72.8464, lat: 19.1197,
    district: "Mumbai Suburban",
    covers: ["Andheri"],
    expect: {
      // Andheri East Police Station 225 m, Pace Junior Science College 160 m,
      // Sai Baba Temple 378 m, Eco Space IT Park 381 m; Andheri metro 0.30 km.
      landmarks: ["Andheri railway station", "Andheri metro station", "Andheri East Police Station", "Pace Junior Science College Andheri", "Sai Baba Temple", "Eco Space It Park"],
      rail: true,
      metroOrMonorail: true,     // Andheri (Line 1) 0.30 km, plus Marol Naka interchange
      water: "none",
      majorRoadExamples: ["Swami Vivekanand Marg", "Prof N S Phadke Road", "S Radhakrishnan Road", "Old Nagardas Road", "CD Barfiwala Road", "Sir Mathuradas Vasanji Marg", "S V Road", "Station Road"],
    },
  },
  {
    id: "juhu",
    name: "Juhu",
    lon: 72.8225, lat: 19.1220,
    district: "Mumbai Suburban",
    covers: ["Juhu"],
    expect: {
      // Samudra Manthan 111 m, Mangal Geeta 148 m, The Anchorage 155 m,
      // Renaissance Club 157 m, Jai Gauri 183 m; Juhu Beach ~0.3 km west.
      landmarks: ["Samudra Manthan", "Mangal Geeta", "The Anchorage", "Renaissance Club", "Jai Gauri", "Juhu Beach"],
      rail: false,               // no WR station inside Juhu
      metroOrMonorail: true,     // Versova (Line 1) 0.93 km — tolerance edge
      water: "coast",
      majorRoadExamples: ["Balasaheb Sawant Road", "J P Road", "Juhu Versova Link Road", "St Louis Convent Road", "N Dutta Road", "Nirmala Devi Arunkumar Ahuja Path", "Cosmopolitan Education Society Marg"],
    },
  },
  {
    id: "jogeshwari",
    name: "Jogeshwari",
    lon: 72.8505, lat: 19.1545,
    district: "Mumbai Suburban",
    covers: ["Juhu"],
    expect: {
      // Parsi Panchayat Complex 249 m, New Radha Sham Niwas 324 m, Shree Ram
      // Mandir ~420 m; the WR station (Ram Mandir) is ~0.15-0.37 km.
      landmarks: ["Jogeshwari railway station", "Parsi Panchayat Complex", "New Radha Sham Niwas", "Shree Ram Mandir"],
      rail: true,
      metroOrMonorail: true,     // Goregaon East (Line 7) 0.67 km
      water: "none",
      majorRoadExamples: ["Swami Vivekanand Marg", "Mrinaltai Gore Flyover", "Ram Mandir Road", "S V Road", "Walbhat Road", "Western Express Highway", "Jawahar Nagar Road No 12"],
    },
  },
  {
    id: "goregaon",
    name: "Goregaon",
    lon: 72.8450, lat: 19.1660,
    district: "Mumbai Suburban",
    covers: ["Juhu"],
    expect: {
      // Mahindra Eminent Angelica Building 298 m, Platinum Heights 301 m, Mangal
      // Kripa CHS 342 m, Tijoriwala Terrace 349 m; station ~0.2-0.5 km.
      landmarks: ["Goregaon railway station", "Mahindra Eminent Angelica Building", "Platinum Heights", "Mangal Kripa Cooperative Housing Society", "Tijoriwala Terrace"],
      rail: true,                // Goregaon Station Road is 0.18 km away
      metroOrMonorail: false,    // nearest mapped metro is 1.18 km
      water: "none",
      majorRoadExamples: ["Swami Vivekanand Marg", "Goregaon Station Road", "Mahatma Gandhi Marg", "S V Road", "Vasari Hill Road", "Siddharth Hospital Marg", "M G Road", "Shri Hari Mandir Marg"],
    },
  },
  {
    id: "malad",
    name: "Malad West",
    lon: 72.8420, lat: 19.1865,
    district: "Mumbai Suburban",
    covers: ["Malad"],
    expect: {
      // Jaswanti Garden 208 m, Jay Mala 233 m, Ayojan Nagar 238 m, Mahavir Tirth
      // 249 m, Moreshwar Dham 255 m, Mamlatdar Wadi 310 m.
      landmarks: ["Jaswanti Garden", "Jay Mala", "Ayojan Nagar", "Mahavir Tirth", "Moreshwar Dham", "Mamlatdar Wadi"],
      rail: true,                // Malad station, "Station Road Malad" 0.64 km
      metroOrMonorail: true,     // Malad West (Line 2A) 0.65 km
      water: "none",
      majorRoadExamples: ["Swami Vivekanand Marg", "Link Road", "Mamledar Wadi Road", "S V Road", "Ramchandra Lane", "Chunilal Giridharilal Marg", "Station Road Malad"],
    },
  },
  {
    id: "malad-east",
    name: "Malad East, Marol Naka side",
    lon: 72.8560, lat: 19.1930,
    district: "Mumbai Suburban",
    covers: ["Malad"],
    expect: {
      // BAPS Swaminarayan Temple 99 m, Adcon Residency 187 m, Reform
      // Residency 203 m; nearest WR station (Malad) is 0.94 km.
      landmarks: ["BAPS Swaminarayan Temple", "Adcon Residency", "Reform Residency", "Morarji Mill Employees CHS"],
      rail: false,               // 0.94 km to Malad, 2.2 km to Kandivali
      metroOrMonorail: true,     // Kurar (Line 7) 0.68 km
      water: "none",
      majorRoadExamples: ["Western Express Highway", "Datta Mandir Road", "Ashok Chakravarty Road", "Daftary Road", "Machubai Road", "Pushpa Park Road", "Tanaji Nagar Road"],
    },
  },
  {
    id: "kandivali",
    name: "Kandivali, Thakur Village",
    lon: 72.8560, lat: 19.2130,
    district: "Mumbai Suburban",
    covers: ["Kandivali"],
    expect: {
      // Mayfair Greens 304 m, Sunder Dham 343 m, Satya Sundaram 392 m,
      // MIT Niketan ~0.5 km; Kandivali station ~0.25 km.
      landmarks: ["Mayfair Greens", "Sunder Dham", "Satya Sundaram", "MIT Niketan"],
      rail: true,                // Western line, Kandivali station ~0.25 km
      metroOrMonorail: false,    // Kandivli West (Line 2A) is 1.9 km away
      water: "none",
      majorRoadExamples: ["Swami Vivekanand Marg", "Gaondevi Road", "Poisar Gymkhana Road", "Bihari Tekadi Road", "90 Feet Road", "St Anthony Road", "Datt Mandir Marg", "S V Road"],
    },
  },
  {
    id: "borivali",
    name: "Borivali",
    lon: 72.8570, lat: 19.2290,
    district: "Mumbai Suburban",
    covers: ["Borivali"],
    expect: {
      // Paras Business Center 124 m, Goyal Shopping Centre 132 m, Borivali
      // Municipal Market 158 m, Jaya Talkies 188 m, Borivali Court 236 m,
      // Gora Gandhi Hotel 227 m; Borivali Station Road 0.58 km.
      landmarks: ["Borivali Police Station", "Borivali Municipal Market", "Goyal Shopping Centre", "Paras Business Center", "Jaya Talkies", "Borivali Court", "Gora Gandhi Hotel"],
      rail: true,                // Western line, Borivali station ~0.58 km
      metroOrMonorail: true,     // Rashtriya Udyan (Line 7) 0.89 km — tolerance edge
      water: "none",             // Borivali lake is 1.6 km north-west
      majorRoadExamples: ["Swami Vivekanand Marg", "Chandawarkar Road", "Sri Mohanlal Parikh Marg", "Main Kasturba Road", "Lt Road", "Lokmanya Tilak Road", "Western Express Highway", "Dattapada Road"],
    },
  },
  {
    id: "dahisar",
    name: "Dahisar",
    lon: 72.8550, lat: 19.2470,
    district: "Mumbai Suburban",
    covers: ["Dahisar"],
    expect: {
      // Shreeji Complex Mandpeshwar 24 m, Vaikunth Apartment 45 m, Union Bank
      // 88 m, Rupel Heights CHS 118 m, Brahmanaaad 120 m, Samaj Kalyan Mandir
      // reading room 251 m; Railway Colony Road / Station Road ~0.2-0.7 km.
      landmarks: ["Shreeji Complex Mandpeshwar", "Vaikunth Apartment", "Union Bank", "Rupel Heights CHS", "Brahmanaaad", "Samaj Kalyan Mandir Reading Room"],
      rail: true,                // Western line, Dahisar station ~0.2-0.7 km
      metroOrMonorail: true,     // Mandapeshwar (Line 2A) ~0.99 km — tolerance edge
      water: "lake",             // the Dahisar / Manjreshwar lake is ~0.6 km west
      majorRoadExamples: ["Laxman Mhatre Marg", "Shri Aurobindo Marg", "Lokmanya Tilak Road", "Holy Cross Road", "Jaywant Sawant Road", "Swami Vivekanand Marg", "Mandapeshwar Road", "Station Road"],
    },
  },
  {
    id: "dahisar-east",
    name: "Dahisar East, metro interchange",
    lon: 72.8670, lat: 19.2512,
    district: "Mumbai Suburban",
    covers: ["Dahisar"],
    expect: {
      // Girnar Tower 264 m, TRCAC 376 m; the Lines 2A/9 interchange is ~0.1 km.
      landmarks: ["Girnar Tower", "TRCAC", "Dahisar East metro station"],
      rail: true,                // Dahisar station 0.71 km west
      metroOrMonorail: true,     // Dahisar East (Lines 2A and 9) ~0.1 km
      water: "none",
      majorRoadExamples: ["Western Express Highway", "Swami Vivekanand Marg", "S V Road", "Chhatrapati Shivaji Road", "Ramkuwar Thakur Road", "Shyam Narayan Dubey Road"],
    },
  },
  {
    id: "bkc",
    name: "Bandra Kurla Complex",
    lon: 72.8520, lat: 19.0600,
    district: "Mumbai Suburban",
    covers: ["Bandra", "Fort"],
    expect: {
      // Hallmark Business Plaza 96 m, Food and Drug Administration 205 m,
      // Hubtown Sunstone 254 m, Family Court 384 m; BKC metro ~0.3 km.
      landmarks: ["Hallmark Business Plaza", "Food and Drug Administration", "Hubtown Sunstone", "Family Court", "Bandra Kurla Complex metro station"],
      rail: false,               // Bandra Terminus is 1.15 km south
      metroOrMonorail: true,     // BKC (Lines 2B/3) 0.3 km
      water: "none",
      majorRoadExamples: ["Bandra Kurla Complex Road", "Western Express Highway", "Ramkrishna Paramhans Road", "Jagat Vidya Marg", "Nanasaheb Dharmadhikari Road", "Aliyawar Jung Marg", "Sant Dnyaneshwar Mandir Road"],
    },
  },

  /* --- Eastern suburbs: the Central line corridor ------------------------- */
  {
    id: "chembur",
    name: "Chembur Naka",
    lon: 72.8995, lat: 19.0605,
    district: "Mumbai Suburban",
    covers: ["Chembur"],
    expect: {
      // BMC M Ward office 95 m, Chembur Mahila Samaj 124 m, Chembur Gymkhana
      // 243 m, Fine Arts Society 246 m, Chembur Vidya Niketan High School 351 m.
      landmarks: ["BMC M Ward", "Chembur Mahila Samaj", "Chembur Gymkhana", "Fine Arts Society", "Chembur Vidya Niketan High School", "Chembur railway station", "Chembur monorail station"],
      rail: true,                // Central line, Chembur station 0.29 km
      metroOrMonorail: true,     // Chembur (Line 2B, from Aug 2026) and the monorail station, 0.22 km
      water: "none",
      majorRoadExamples: ["Eastern Express Highway", "Santacruz Chembur Link Road", "Ramkrishna Chemburkar Marg", "Swami Dayanand Marg", "P L Lokhande Marg", "Dattatraya Krishna Sandu Marg"],
    },
  },
  {
    id: "ghatkopar",
    name: "Ghatkopar",
    lon: 72.9080, lat: 19.0860,
    district: "Mumbai Suburban",
    covers: ["Ghatkopar"],
    expect: {
      // Ghatkopar West Station Building 92 m, Gurukrupa Garden 189 m, Vardhaman
      // Sthanakvasi Sangh 340 m; Ghatkopar station building 0.09 km.
      landmarks: ["Ghatkopar railway station", "Ghatkopar West Station Building", "Gurukrupa Garden", "Vardhaman Sthanakvasi Sangh Ghatkopar East", "Ghatkopar metro station"],
      rail: true,                // Central + Western lines, Ghatkopar station 0.09 km
      metroOrMonorail: true,     // Ghatkopar (Line 1) 0.08 km
      water: "none",
      majorRoadExamples: ["Lal Bahadur Shastri Marg", "Ghatkopar Andheri Link Road", "90 Ft Road", "Mahatma Gandhi Marg", "Harischand Desai Road", "Station Road", "Ram Narayan Narkar Road"],
    },
  },
  {
    id: "mulund",
    name: "Mulund",
    lon: 72.9390, lat: 19.0590,
    district: "Mumbai Suburban",
    covers: ["Mulund"],
    expect: {
      // Named-building coverage is thin here; Mulund station is ~0.3-0.7 km and
      // the Kachara Depot (RCD) sits just north of the point.
      landmarks: ["Mulund railway station", "Kachara Depot"],
      rail: true,                // harbour-branch Central line
      metroOrMonorail: false,    // Mulund Naka / Mulund Fire Station (Line 4) are under construction
      water: "none",
      majorRoadExamples: ["Yashwantrao Chavan Marg", "Veermata Jeejabai Bhosle Marg", "Kachara Depot Road", "30 Ft Road", "Sant Gagangiri Maharaj Marg", "Ahilyabai Holkar Marg"],
    },
  },
  {
    id: "powai",
    name: "Powai, Hiranandani Gardens",
    lon: 72.9160, lat: 19.1180,
    district: "Mumbai Suburban",
    covers: ["Powai"],
    expect: {
      // MTNL Exchange / CETTM 85 m, CETTM Hostel 144 m, Dr. L. H. Hiranandani
      // Hospital 202 m, Tatapower 264 m; Hiranandani Lake ~0.5 km north.
      landmarks: ["Hiranandani Gardens", "Dr. L. H. Hiranandani Hospital", "Tatapower", "MTNL Exchange", "CETTM (MTNL) office"],
      rail: false,
      metroOrMonorail: false,    // IIT Powai / Powai Lake (Line 6) are under construction
      water: "lake",             // Hiranandani Lake ~0.5 km, Powai Lake ~1.2 km west
      majorRoadExamples: ["Hiranandani Link Road", "Central Avenue", "Main Street Road", "Tirandaj Gaothan Road", "Shree Ayyappa Vishnu Temple Road", "Adi Shankaracharya Marg", "Pipe Line Road"],
    },
  },
  {
    id: "vikhroli",
    name: "Vikhroli",
    lon: 72.9300, lat: 19.1100,
    district: "Mumbai Suburban",
    covers: ["Vikhroli"],
    expect: {
      // J. K Towers 136 m, Sai Suman 222 m, railway ticket counter 261 m, St
      // Joseph's High School 288 m; Vikhroli Station Road passes the point.
      landmarks: ["J. K Towers", "Sai Suman", "St Joseph's High School", "Vikhroli railway station", "Godrej Colony"],
      rail: true,                // Central line, Vikhroli station ~0.2 km
      metroOrMonorail: false,    // the Vikhroli metro (Line 6) is under construction
      water: "none",
      majorRoadExamples: ["Eastern Express Highway", "Lal Bahadur Shastri Marg", "Vikhroli Village Road", "Vikhroli Station Road", "P Godrej Marg", "Ramakant Deshmukh Marg", "Tagore Nagar Road"],
    },
  },
  {
    id: "kanjurmarg",
    name: "Kanjurmarg",
    lon: 72.9285, lat: 19.1295,
    district: "Mumbai Suburban",
    covers: ["Kanjurmarg"],
    expect: {
      // Celesta 163 m, Mahavir Majestik 168 m, Belvedere 203 m, Toyo
      // Technology Centre 417 m; Kan Jurmarg Station Road is right here.
      landmarks: ["Celesta", "Mahavir Majestik C. H. S.", "Belvedere", "Kanjur Marg railway station", "Toyo Technology Centre"],
      rail: true,                // Central line, Kanjur Marg station ~0.17 km
      metroOrMonorail: false,    // Kanjurmarg (West) (Line 6) / Gandhi Nagar (Line 4) are under construction
      water: "none",
      majorRoadExamples: ["Adi Shankaracharya Marg", "Lal Bahadur Shastri Marg", "Kan Jurmarg Station Road", "Jogeshwari Vikhroli Link Road", "L B S Road", "Kanjur Village Road", "Tagore Nagar Road"],
    },
  },
  {
    id: "bhandup",
    name: "Bhandup",
    lon: 72.9370, lat: 19.1445,
    district: "Mumbai Suburban",
    covers: ["Bhandup"],
    expect: {
      // Pawar Public School 401 m, Joy Homes CHS 415 m; Bhandup Station Road is
      // at the point, so the station is ~0.2-0.5 km.
      landmarks: ["Bhandup railway station", "Pawar Public School", "Joy Homes CHS"],
      rail: true,                // Central line, Bhandup station ~0.2-0.5 km
      metroOrMonorail: false,    // Bhandup (Line 4) is under construction
      water: "none",
      majorRoadExamples: ["Lal Bahadur Shastri Marg", "Swatantryaveer Savarkar Marg", "Lbs Road", "Bhandup Station Road", "Usha Complex Society Road", "Tank Road", "J M Road"],
    },
  },

  /* --- Far north and Navi Mumbai (Thane district) ------------------------- */
  {
    id: "thane",
    name: "Thane",
    lon: 72.9700, lat: 19.1880,
    district: "Thane",
    covers: ["Thane"],
    expect: {
      // Gautam Tower 120 m, Sai Sadan 223 m, Ambika Bhavan 224 m, Naupada
      // Police Station 347 m; Station Road 0.58 km.
      landmarks: ["Naupada Police Station", "Gautam Tower", "Sai Sadan", "Ambika Bhavan", "Thane railway station"],
      rail: true,                // Central line, Thane station ~0.1-0.6 km
      metroOrMonorail: false,    // every Thane line (4 and 5) is under construction
      water: "none",             // Thane Creek is ~2 km north-west
      majorRoadExamples: ["Gokhale Road", "Mahatma Gandhi Road", "Eastern Express Highway", "Ram Maruti Road", "Lal Bahadur Shastri Marg", "Station Road", "Lokmanya Tilak Road", "Veer Baji Prabhu Deshpande Road"],
    },
  },
  {
    id: "belapur",
    name: "CBD Belapur, Navi Mumbai",
    lon: 73.0395, lat: 19.0205,
    district: "Thane",
    covers: ["Navi Mumbai"],
    expect: {
      // "CBD Belapur" 62 m, Konkan Bhavan 249 m, Reserve Bank of India 322 m;
      // CBD Belapur Railway Station Road is at the point.
      landmarks: ["CBD Belapur", "CBD Belapur railway station", "CBD Belapur metro station", "Konkan Bhavan", "Reserve Bank of India"],
      rail: true,                // Harbour line, CBD Belapur station ~0.08 km
      metroOrMonorail: true,     // CBD Belapur (Line 8) ~0.08 km
      water: "creek",            // the Belapur Creek / Ulhas estuary is ~0.6 km east
      majorRoadExamples: ["Sion Panvel Expressway", "Comm Bhau Sakaram Patil Marg", "Sakal Bhavan Marg", "Parampujya Shree Nirmala Devi Marg", "Pandit Jawaharlal Nehru Marg", "Pandharinath Bala Vaskar Road", "CBD Belapur Railway Station Road"],
    },
  },
  {
    id: "vashi",
    name: "Vashi, Navi Mumbai",
    lon: 72.9970, lat: 19.0770,
    district: "Thane",
    covers: ["Navi Mumbai"],
    expect: {
      // Reshma CHS 128 m, Shri Guru Singh Sabha Gurudwara 197 m, Akhil Bharatiya
      // Gandharva Mahavidyalaya 215 m, Arya Samaj Mandir 230 m, Jhulelal Mandir
      // 235 m, Vegetable Market 260 m.
      landmarks: ["Shri Guru Singh Sabha Gurudwara", "Akhil Bharatiya Gandharva Mahavidyalaya", "Arya Samaj Mandir and Ashram", "Jhulelal Mandir", "Vegetable Market", "Reshma CHS"],
      rail: false,               // Vashi station is ~1.3 km west
      metroOrMonorail: false,    // the Navi Mumbai lines (8) are under construction
      water: "none",             // the Vashi backwater is ~0.7 km north
      majorRoadExamples: ["Vashi Road", "Rajarshi Chhatrapati Shahu Maharaj Marg", "Baban Parshuram Kadam Path", "Palm Beach Road", "Shivshakti Road", "Tanaji Malusare Marg", "Ganesh Mandir Road"],
    },
  },
];

/* ------------------------------------------------------------------ *
 * Self-check + summary (run with `node scripts/validation-sites.mjs`).
 * No dependencies, no fixtures — the manifest asserts itself.
 * ------------------------------------------------------------------ */

const DISTRICTS = ["Mumbai City", "Mumbai Suburban", "Thane"];
const WATERS = ["none", "coast", "creek", "lake"];

/** @returns {string[]} the problems found, empty when the manifest is sound */
export function checkManifest(sites = VALIDATION_SITES) {
  const bad = [];
  const ids = new Set();
  for (const s of sites) {
    const at = s.id ?? "<no id>";
    if (ids.has(s.id)) bad.push(`${at}: duplicate id`);
    ids.add(s.id);
    if (!s.name) bad.push(`${at}: no name`);
    // WGS84 degrees, and inside the Greater Mumbai metro box.
    if (!(s.lon > 72.6 && s.lon < 73.2)) bad.push(`${at}: lon ${s.lon} outside the metro`);
    if (!(s.lat > 18.7 && s.lat < 19.5)) bad.push(`${at}: lat ${s.lat} outside the metro`);
    // The brief asks for ~4 decimal places. Assert the value sits exactly on
    // the 4-decimal grid rather than counting digits: JS drops trailing zeros,
    // so `18.9900` arrives as 18.99 and a digit count reads it as 2 dp.
    for (const k of ["lon", "lat"]) {
      if (Math.abs(s[k] - Number(s[k].toFixed(4))) > 1e-9) bad.push(`${at}: ${k} ${s[k]} is finer than 4 decimals`);
    }
    if (!DISTRICTS.includes(s.district)) bad.push(`${at}: district "${s.district}" not one of ${DISTRICTS.join("/")}`);
    const e = s.expect;
    if (!e) { bad.push(`${at}: no expect block`); continue; }
    if (!e.landmarks?.length) bad.push(`${at}: no landmarks`);
    if (!e.majorRoadExamples?.length) bad.push(`${at}: no majorRoadExamples`);
    if (typeof e.rail !== "boolean") bad.push(`${at}: rail must be a boolean`);
    if (typeof e.metroOrMonorail !== "boolean") bad.push(`${at}: metroOrMonorail must be a boolean`);
    if (!WATERS.includes(e.water)) bad.push(`${at}: water "${e.water}" not one of ${WATERS.join("/")}`);
    for (const [k, v] of Object.entries(e)) {
      if (k.endsWith("Examples") || k === "landmarks") {
        for (const n of v) if (typeof n !== "string" || !n.trim()) bad.push(`${at}: empty name in ${k}`);
      }
    }
  }
  if (sites.length < 22) bad.push(`only ${sites.length} sites, the brief requires at least 22`);
  const covered = new Set(sites.flatMap((s) => s.covers ?? []));
  for (const a of REQUIRED_AREAS) if (!covered.has(a)) bad.push(`required area "${a}" is not covered`);
  for (const id of THANE_DISTRICT_SITES) {
    const s = sites.find((x) => x.id === id);
    if (s && s.district !== "Thane") bad.push(`${id}: listed in THANE_DISTRICT_SITES but district is "${s.district}"`);
  }
  return bad;
}

/** One line per site, then the totals. Returns the text so it is testable. */
export function summarize(sites = VALIDATION_SITES) {
  const lines = sites.map((s, i) => {
    const e = s.expect;
    const flags = [
      `landmarks=${e.landmarks.length}`,
      `roads=${e.majorRoadExamples.length}`,
      `rail=${e.rail ? "yes" : "no"}`,
      `metro=${e.metroOrMonorail ? "yes" : "no"}`,
      `water=${e.water}`,
    ];
    return `${String(i + 1).padStart(2)}  ${s.id.padEnd(17)} ${s.name.padEnd(34)} ${s.lon.toFixed(4)},${s.lat.toFixed(4)}  ${s.district.padEnd(17)} ${flags.join(" ")}`;
  });

  const byDistrict = new Map();
  const byWater = new Map();
  let rail = 0, transit = 0;
  for (const s of sites) {
    byDistrict.set(s.district, (byDistrict.get(s.district) ?? 0) + 1);
    byWater.set(s.expect.water, (byWater.get(s.expect.water) ?? 0) + 1);
    rail += s.expect.rail ? 1 : 0;
    transit += s.expect.metroOrMonorail ? 1 : 0;
  }
  const covered = [...new Set(sites.flatMap((s) => s.covers ?? []))].sort();
  const lines2 = [
    "",
    `sites: ${sites.length}`,
    `district coverage: ${[...byDistrict].map(([k, v]) => `${k} ${v}`).join(" | ")}`,
    `area coverage (${covered.length}/${REQUIRED_AREAS.length} required): ${covered.join(", ")}`,
    `rail within ~1 km: ${rail}/${sites.length} | metro or monorail within ~1 km: ${transit}/${sites.length}`,
    `water: ${WATERS.map((w) => `${w} ${byWater.get(w) ?? 0}`).join(" | ")}`,
  ];
  return [...lines, ...lines2].join("\n");
}

// Run only when executed directly. `pathToFileURL` (not string interpolation)
// because this repo path contains spaces, which a `file://` concat mangles.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(summarize());
  const bad = checkManifest();
  if (bad.length) {
    console.error(`\nFAIL  ${bad.length} problems:`);
    for (const b of bad) console.error(`      ${b}`);
    process.exit(1);
  }
  console.log(`\nok    self-check passed: ${VALIDATION_SITES.length} sites, ${new Set(VALIDATION_SITES.flatMap((s) => s.covers)).size} required areas, ids and ranges sane.`);
}
