"""Demo content: the fictional exercise IRON ANVIL 26 (an amphibious and land exercise on the coast of Camp Pendleton,
California), so the map is alive on the first visit. Every name, unit, ship, MMSI and callsign is made up.

Loaded automatically the first time anyone opens the app (ensure_loaded), removed or reloaded from Admin -> Demo data.
Removing it is remembered. Demo users have is_demo=True and @example.com emails; they can't sign in. Every demo row
is flagged is_demo=True; remove() also deletes everyone's subscriptions to the demo feeds.

The features are built here the same way the browser parsers build them from real files (see Drops.py for the format).
"""
import datetime as dt
import math
import random

from anvil.tables import app_tables

from . import common as C

EX = "UNCLASSIFIED // EXERCISE"
DEMO_USERS = [
    ("Maj. Elena Varga", "elena.varga.demo@example.com"),    # 0 brigade intelligence (S2)
    ("Capt. Ravi Okafor", "ravi.okafor.demo@example.com"),   # 1 task force operations
    ("Lt. Sofia Lindqvist", "sofia.lindqvist.demo@example.com"),  # 2 maritime
    ("WO Marc Dubé", "marc.dube.demo@example.com"),          # 3 UAV crew
]
# Tables that hold demo rows (each has an is_demo column). Children before parents.
DEMO_TABLES = ["subscriptions", "drops", "feeds"]

OBJ = (33.395, -117.335)       # OBJ FORGE
AA = (33.300, -117.420)        # assembly area ANVIL


# ----------------------------------------------------------------------------------------------- geometry helpers
def off(p, north_m, east_m):
    lat, lon = p
    return (lat + north_m / 111320.0, lon + east_m / (111320.0 * math.cos(math.radians(lat))))


def dist_bearing(a, b):
    dn = (b[0] - a[0]) * 111320.0
    de = (b[1] - a[1]) * 111320.0 * math.cos(math.radians(a[0]))
    return math.hypot(dn, de), (math.degrees(math.atan2(de, dn)) + 360) % 360


def dest(p, dist_m, bearing):
    b = math.radians(bearing)
    return off(p, dist_m * math.cos(b), dist_m * math.sin(b))


def lerp(a, b, f):
    return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)


def along(path, s):
    """The point s metres along a polyline (clamped), and the heading there."""
    for a, b in zip(path, path[1:]):
        d, brg = dist_bearing(a, b)
        if s <= d:
            return lerp(a, b, s / d if d else 0), brg
        s -= d
    return path[-1], dist_bearing(path[-2], path[-1])[1]


def ll(p):
    return [round(p[0], 6), round(p[1], 6)]


def sidc(aff, dim, func="", mod="-", ech="-"):
    return ("S" + aff + dim + "P" + func.ljust(6, "-") + mod + ech + "---")[:15]


def iso(t):
    return t.isoformat().replace("+00:00", "Z")


def sector(sensor, center, half_range_m, half_angle_deg, n=10):
    d, brg = dist_bearing(sensor, center)
    near, far = max(500.0, d - half_range_m), d + half_range_m
    pts = [dest(sensor, far, brg - half_angle_deg + 2 * half_angle_deg * i / n) for i in range(n + 1)]
    pts += [dest(sensor, near, brg + half_angle_deg - 2 * half_angle_deg * i / n) for i in range(n + 1)]
    return [ll(p) for p in pts]


def quad(center, heading, w_m, h_m):
    a = math.degrees(math.atan2(w_m, h_m))
    r = math.hypot(w_m / 2, h_m / 2)
    return [ll(dest(center, r, heading + b)) for b in (a, 180 - a, 180 + a, 360 - a)]


# ----------------------------------------------------------------------------------------------- the feeds
def _blue_force(now, rnd):
    units = [("TF ANVIL HQ", sidc("F", "G", "UCI", "A", "F"), (33.296, -117.432), .45),
             ("A/1-5 MECH", sidc("F", "G", "UCIZ", ech="E"), (33.305, -117.415), 1.0),
             ("B/1-5 MECH", sidc("F", "G", "UCIZ", ech="E"), (33.292, -117.405), 1.0),
             ("C/1-5 INF", sidc("F", "G", "UCI", ech="E"), (33.315, -117.425), .9),
             ("1/D/2-8 AR", sidc("F", "G", "UCA", ech="D"), (33.300, -117.398), 1.15),
             ("2/D/2-8 AR", sidc("F", "G", "UCA", ech="D"), (33.288, -117.392), 1.1),
             ("SCOUT PLT", sidc("F", "G", "UCR", ech="D"), (33.318, -117.400), 1.35),
             ("B/3-11 FA", sidc("F", "G", "UCF", ech="E"), (33.280, -117.440), .3),
             ("ENG PLT", sidc("F", "G", "UCE", ech="D"), (33.302, -117.410), .95),
             ("ADA SEC", sidc("F", "G", "UCD", ech="C"), (33.294, -117.425), .6),
             ("FSC SUPPLY", sidc("F", "G", "USS", ech="E"), (33.285, -117.448), .35),
             ("AID STATION", sidc("F", "G", "USM", ech="D"), (33.290, -117.445), .3),
             ("SIG TEAM", sidc("F", "G", "UUS", ech="B"), (33.298, -117.436), .4)]
    drops = []
    for k in range(8):
        t = now - dt.timedelta(minutes=20 * (7 - k) + 6)
        feats = []
        for i, (name, code, start, speed) in enumerate(units):
            target = (OBJ[0] + (start[0] - AA[0]) * .7 - .012, OBJ[1] + (start[1] - AA[1]) * .7 - .01)
            prev = lerp(start, target, min(.78, max(0, k - 1) * .095 * speed))
            p = lerp(start, target, min(.78, k * .095 * speed))
            p = off(p, rnd.uniform(-40, 40), rnd.uniform(-40, 40))
            d, course = dist_bearing(prev, p)
            feats.append({"g": "pt", "c": ll(p), "s": code, "n": name, "id": "TFA-%02d" % i, "t": iso(t),
                          "p": {"speed_kmh": round(d / 1200 * 3.6, 1), "course": round(course), "status": "FULLY CAPABLE",
                                "strength": "%d%%" % rnd.randint(84, 100), "source": "NFFI IP1 / trackSource TF-ANVIL"}})
        drops.append(("nffi_cycle_%02d.xml" % (k + 1), "nffi", t, {"tracks": len(feats), "message": "NFFI 1.3", "cycle": k + 1}, feats))
    return drops


def _ops_overlay(now):
    t = iso(now - dt.timedelta(hours=3, minutes=10))
    blue = "#4fb3ff"
    pl_iron = [ll(p) for p in [(33.325, -117.470), (33.352, -117.405), (33.366, -117.345), (33.374, -117.290)]]
    pl_steel = [ll(p) for p in [(33.360, -117.480), (33.383, -117.415), (33.392, -117.355), (33.402, -117.300)]]
    ld = [ll(p) for p in [(33.318, -117.445), (33.322, -117.405), (33.326, -117.375), (33.334, -117.335)]]
    bdry = [ll(p) for p in [(33.270, -117.410), (33.330, -117.380), (33.390, -117.350), (33.450, -117.318)]]
    obj = [ll(off(OBJ, 1800 * math.cos(math.radians(a)), 2300 * math.sin(math.radians(a)))) for a in range(0, 360, 30)]
    aa = [ll(off(AA, 1400 * math.cos(math.radians(a)), 1800 * math.sin(math.radians(a)))) for a in range(0, 360, 40)]
    feats = [
        {"g": "ln", "c": ld, "n": "LD / LC SPARK", "t": t, "col": blue, "p": {"graphic": "Line of departure"}},
        {"g": "ln", "c": pl_iron, "n": "PL IRON", "t": t, "col": blue, "p": {"graphic": "Phase line"}},
        {"g": "ln", "c": pl_steel, "n": "PL STEEL", "t": t, "col": blue, "p": {"graphic": "Phase line"}},
        {"g": "ln", "c": bdry, "n": "BDRY 1-5 | 2-8", "t": t, "col": "#9aa3ad", "p": {"graphic": "Boundary"}},
        {"g": "pg", "c": obj, "n": "OBJ FORGE", "t": t, "col": "#f2b646", "p": {"graphic": "Objective"}},
        {"g": "pg", "c": aa, "n": "AA ANVIL", "t": t, "col": blue, "p": {"graphic": "Assembly area"}},
        {"g": "ci", "c": ll(off(OBJ, 1500, 2500)), "r": 4500, "n": "ROZ EMBER (SFC-3000 m)", "t": t, "col": "#f2b646",
         "p": {"graphic": "Restricted operations zone", "floor_m": 0, "ceiling_m": 3000}},
    ]
    return [("iron_anvil_ops_overlay_v3.kmz", "kml", now - dt.timedelta(hours=3, minutes=10),
             {"placemarks": len(feats), "document": "IRON ANVIL 26 Ops Overlay v3"}, feats)]


def _opfor(now, rnd):
    red = "#e05d5d"
    units = [("12 MRB HQ", sidc("H", "G", "UCI", "A", "F"), (33.428, -117.302)),
             ("1 MRC", sidc("H", "G", "UCIZ", ech="E"), (33.401, -117.322)),
             ("2 MRC", sidc("H", "G", "UCIZ", ech="E"), (33.407, -117.348)),
             ("TK PLT", sidc("H", "G", "UCA", ech="D"), (33.414, -117.331)),
             ("ARTY BTY", sidc("H", "G", "UCF", ech="E"), (33.446, -117.296)),
             ("AD SEC", sidc("H", "G", "UCD", ech="C"), (33.425, -117.318)),
             ("RECON SEC", sidc("H", "G", "UCR", ech="C"), (33.381, -117.362)),
             ("SUSPECTED OP", sidc("S", "G", "UCR", ech="B"), (33.371, -117.373)),
             ("UNK VEH x3", sidc("U", "G", "EV"), (33.388, -117.302))]
    drops = []
    for k, ago in enumerate((165, 38)):
        t = now - dt.timedelta(minutes=ago)
        feats = []
        for i, (name, code, p) in enumerate(units):
            q = off(p, -350 * k + rnd.uniform(-60, 60), 180 * k + rnd.uniform(-60, 60)) if i in (1, 2, 3, 6) else p
            feats.append({"g": "pt", "c": ll(q), "s": code, "n": name, "id": "OPF-%02d" % i, "t": iso(t),
                          "p": {"confidence": ["CONFIRMED", "PROBABLE", "POSSIBLE"][i % 3], "source": "S2 assessment"}})
        if k == 0:
            line = [ll(p) for p in [(33.392, -117.372), (33.399, -117.352), (33.404, -117.330), (33.410, -117.310)]]
            ring = lambda c, a, b: [ll(off(c, a * math.cos(math.radians(x)), b * math.sin(math.radians(x)))) for x in range(0, 360, 45)]  # noqa: E731
            feats += [
                {"g": "ln", "c": line, "n": "Enemy main defensive line", "t": iso(t), "col": red, "p": {"graphic": "Defensive line (estimated)"}},
                {"g": "ci", "c": ll(units[4][2]), "r": 15000, "n": "ARTY range fan (15 km)", "t": iso(t), "col": red,
                 "p": {"graphic": "Weapon range fan", "system": "122 mm SP howitzer (estimated)"}},
                {"g": "pg", "c": ring((33.372, -117.395), 700, 900), "n": "NAI 1", "t": iso(t), "col": "#d9d4c7", "p": {"graphic": "Named area of interest"}},
                {"g": "pg", "c": ring((33.452, -117.283), 800, 1000), "n": "NAI 2", "t": iso(t), "col": "#d9d4c7", "p": {"graphic": "Named area of interest"}},
            ]
        drops.append(("opfor_sitemp_%s.nvg" % ("am" if k == 0 else "update"), "nvg", t,
                      {"elements": len(feats), "nvg_version": "1.5.0", "symbology": "2525C"}, feats))
    return drops


ROADS = {
    "red": [(33.480, -117.255), (33.462, -117.272), (33.447, -117.290), (33.430, -117.305), (33.418, -117.318)],
    "i5": [(33.200, -117.385), (33.245, -117.432), (33.290, -117.478), (33.335, -117.520), (33.380, -117.566)],
    "blue": [(33.300, -117.420), (33.322, -117.398), (33.345, -117.376), (33.366, -117.360)],
}


def _gmti(now, rnd):
    orbit_c, orbit_r = (33.205, -117.800), 14000.0
    convoys = [("red", 11, 9.0, 1800, "hostile column"), ("i5", 14, 27.0, 0, "coastal traffic"),
               ("i5", 9, -26.0, 30000, "coastal traffic"), ("blue", 8, 6.5, 500, "friendly move")]
    lengths = {k: sum(dist_bearing(a, b)[0] for a, b in zip(v, v[1:])) for k, v in ROADS.items()}
    drops = []
    dwell = 0
    for k in range(8):
        feats = []
        for j in range(3):
            t = now - dt.timedelta(minutes=4 * (23 - dwell) + 2)
            secs = (t - (now - dt.timedelta(hours=2))).total_seconds()
            ang = (secs / 1800.0) * 360
            plat = dest(orbit_c, orbit_r, ang)
            feats.append({"g": "pt", "c": ll(plat), "s": sidc("F", "A", "MFR"), "n": "FORGE 21", "id": "FORGE21", "t": iso(t),
                          "p": {"alt_m": 9144, "speed_kts": 410, "course": round((ang + 90) % 360), "platform": "E-8 class (simulated)"}})
            feats.append({"g": "pg", "c": sector(plat, (33.40, -117.36), 13000, 17), "n": "Dwell %d" % (dwell + 1), "id": "FORGE21/dwell",
                          "t": iso(t), "e": 1, "col": "#ff7a2f", "p": {"revisit": dwell // 3, "dwell_index": dwell}})
            for road, n, v, s0, label in convoys:
                path = ROADS[road] if v > 0 else ROADS[road][::-1]
                total = lengths[road]
                for i in range(n):
                    s = s0 + abs(v) * secs - i * 140
                    s = s % total if road == "i5" else min(max(s, 0), total - 10)
                    p, brg = along(path, s)
                    p = off(p, rnd.uniform(-25, 25), rnd.uniform(-25, 25))
                    _, los = dist_bearing(plat, p)
                    feats.append({"g": "pt", "c": ll(p), "m": 1, "e": 1, "t": iso(t),
                                  "p": {"los_ms": round(abs(v) * math.cos(math.radians(brg - los)), 1), "snr_db": rnd.randint(9, 27),
                                        "class": "Tracked vehicle, live" if road == "red" else "Wheeled vehicle, live", "group": label}})
            for _ in range(7):
                p = off((33.40, -117.36), rnd.uniform(-9000, 9000), rnd.uniform(-9000, 9000))
                feats.append({"g": "pt", "c": ll(p), "m": 1, "e": 1, "t": iso(t),
                              "p": {"los_ms": round(rnd.uniform(-4, 4), 1), "snr_db": rnd.randint(6, 12), "class": "Unknown, live"}})
            dwell += 1
        targets = sum(1 for f in feats if f.get("m"))
        drops.append(("FORGE21_K%02d.4607" % (k + 1), "4607", now - dt.timedelta(minutes=4 * (23 - dwell + 1)),
                      {"version": "3.1", "platform": "FORGE21", "mission": 2611, "job": 7, "nationality": "XX",
                       "classification": "UNCLASSIFIED", "exercise": "Exercise, synthesized", "dwells": 3, "targets": targets,
                       "packets": 3}, feats))
    return drops


def _fmv(now, rnd):
    center = off(OBJ, 600, 300)
    drops = []
    for clip in range(4):
        feats, centre_line = [], []
        for i in range(20):
            t = now - dt.timedelta(minutes=10 * (3 - clip) + (19 - i) * .5 + 1)
            ang = (clip * 20 + i) * 9.0
            plat = dest(center, 3800, ang)
            fc = off(center, 500 * math.sin(math.radians(ang * 2)), 600 * math.cos(math.radians(ang * 1.5)))
            _, heading = dist_bearing(plat, fc)
            centre_line.append(ll(fc))
            feats.append({"g": "pt", "c": ll(plat), "s": sidc("F", "A", "MFQ"), "n": "EMBER 07", "id": "EMBER07", "t": iso(t),
                          "p": {"alt_m": 2440, "heading": round((ang + 90) % 360), "sensor_az": round(heading), "hfov": 4.6,
                                "slant_m": round(math.hypot(3800, 2440)), "platform": "SKYFORGE (simulated)"}})
            if i % 2 == 0:
                feats.append({"g": "pg", "c": quad(fc, heading, 520, 400), "n": "EMBER 07 footprint", "id": "EMBER07/fp", "t": iso(t),
                              "e": 1, "col": "#f2b646", "p": {"frame_centre": ll(fc), "hfov": 4.6, "vfov": 3.5}})
        feats.append({"g": "ln", "c": centre_line, "n": "EMBER 07 frame centre, clip %d" % (clip + 1), "t": feats[-1]["t"],
                      "col": "#f2b646", "e": 1, "p": {"graphic": "Sensor frame-centre track"}})
        drops.append(("EMBER07_clip%02d.ts" % (clip + 1), "4609", now - dt.timedelta(minutes=10 * (3 - clip)),
                      {"platform": "SKYFORGE", "callsign": "EMBER 07", "sensor": "EO/IR turret", "klv_packets": 600,
                       "duration_s": 600, "video": "H.264", "uas_ls_version": 18, "checksum_errors": 0}, feats))
    return drops


def _maritime(now, rnd):
    ships = [("MV CASCADE TRADER", "XMC", 366912410, (33.080, -117.520), 315, 7.4),
             ("MT PACIFIC RESOLVE", "XMO", 538007711, (33.320, -117.760), 140, 6.2),
             ("MV ORCA BAY", "XMC", 316045812, (33.150, -117.640), 320, 8.0),
             ("FV LUCKY MARLIN", "XF", 367220013, (33.215, -117.505), 250, 2.1),
             ("SV WINDFALL", "XR", 338114415, (33.180, -117.455), 200, 3.0),
             ("MV CORAL EXPRESS", "XMP", 310664016, (33.050, -117.600), 330, 9.5),
             ("TUG HARBOR KING", "XMTU", 367400017, (33.190, -117.420), 300, 4.0)]
    drops = []
    for k in range(5):
        t = now - dt.timedelta(minutes=15 * (4 - k) + 3)
        feats = []
        for name, func, mmsi, start, course, kts in ships:
            p = dest(start, kts * 0.5144 * 900 * k, course)
            feats.append({"g": "pt", "c": ll(p), "s": sidc("N", "S", func), "n": name, "id": "AIS-%d" % mmsi, "t": iso(t),
                          "p": {"mmsi": mmsi, "sog_kts": kts, "cog": course, "nav_status": "Under way using engine"}})
        drops.append(("ais_capture_%02d.nmea" % (k + 1), "ais", t, {"sentences": len(feats) * 3, "vessels": len(feats), "types": "1, 5"}, feats))
    navy = [("FFH VULCAN", sidc("F", "S", "CLFF"), (33.165, -117.560), 330, 12.0, "a-f-S-C-L-F-F"),
            ("LHD ANVIL BAY", sidc("F", "S", "CA"), (33.185, -117.505), 20, 5.0, "a-f-S-C-A"),
            ("LCAC 41", sidc("F", "S", "CA"), (33.205, -117.470), 45, 22.0, "a-f-S-C-A"),
            ("CONTACT 4471", sidc("S", "S", ""), (33.290, -117.700), 160, 11.0, "a-s-S"),
            ("ROTOR 3-1", sidc("F", "A", "MHU"), (33.190, -117.500), 40, 95.0, "a-f-A-M-H-U")]
    for k in range(4):
        t = now - dt.timedelta(minutes=12 * (3 - k) + 1)
        feats = []
        for i, (name, code, start, course, kts, cot) in enumerate(navy):
            dist = kts * 0.5144 * 720 * k * (0.35 if name == "ROTOR 3-1" else 1)
            p = dest(start, min(dist, 26000), course)
            feats.append({"g": "pt", "c": ll(p), "s": code, "n": name, "id": "COT-%s" % name.replace(" ", "-"), "t": iso(t),
                          "p": {"cot": cot, "how": "m-g" if i != 3 else "h-e", "course": course, "speed_ms": round(kts * 0.5144, 1)}})
        drops.append(("tak_server_%02d.cot" % (k + 1), "cot", t, {"events": len(feats)}, feats))
    return drops


def _imagery(now):
    drops = []
    for name, sensor, c, hdg, ago in [("IMG 2910-A", "EO", (33.372, -117.395), 12, 150), ("IMG 2910-B", "SAR", (33.452, -117.283), -20, 95),
                                      ("IMG 2911-A", "IR", OBJ, 35, 25)]:
        t = now - dt.timedelta(minutes=ago)
        feats = [{"g": "pg", "c": quad(c, hdg, 2600, 2000), "n": "%s · %s" % (name, sensor), "t": iso(t), "col": "#b38cff",
                  "p": {"icat": sensor, "nrows": 8192, "ncols": 8192, "icords": "G", "isorce": "SIMULATED"}}]
        drops.append((name.replace(" ", "_") + ".ntf", "4545", t, {"version": "NSIF01.01", "images": 1, "classification": "UNCLASSIFIED",
                                                                  "title": "%s %s collection, IRON ANVIL 26" % (name, sensor)}, feats))
    return drops


def _private(now):
    t = iso(now - dt.timedelta(hours=1))
    feats = [{"g": "pg", "c": [ll(p) for p in [(33.43, -117.36), (33.45, -117.30), (33.42, -117.27), (33.40, -117.32)]],
              "n": "Most likely COA: counter-attack axis", "t": t, "col": "#e05d5d", "p": {"graphic": "Axis of advance (estimated)"}}]
    return [("s2_working_estimate.geojson", "geojson", now - dt.timedelta(hours=1), {"features": 1}, feats)]


FEEDS = [  # owner, name, description, color, featured, visibility, builder
    (1, "TF ANVIL · Blue Force (NFFI)", "Friendly force tracks for Task Force ANVIL, from the NFFI gateway every 20 minutes.", "#4fb3ff", True, "public", "_blue_force"),
    (1, "TF ANVIL · Ops Overlay (KML)", "Phase lines, boundaries, objective and assembly area for IRON ANVIL 26.", "#d9d4c7", True, "public", "_ops_overlay"),
    (0, "OPFOR SITEMP · S2 (NVG)", "Enemy situation template from brigade S2: estimated positions, defensive line, range fans, NAIs.", "#e05d5d", True, "public", "_opfor"),
    (0, "FORGE 21 · GMTI Orbit K (STANAG 4607)", "Simulated wide-area GMTI from FORGE 21, orbiting offshore. Dwells every 4 minutes.", "#ff7a2f", True, "public", "_gmti"),
    (3, "EMBER 07 · FMV metadata (STANAG 4609)", "KLV (MISB ST 0601) from EMBER 07's full-motion video: platform track and sensor footprints over OBJ FORGE.", "#f2b646", True, "public", "_fmv"),
    (2, "Maritime picture · AIS + CoT", "Merchant traffic from an AIS receiver and the amphibious group's CoT from the TAK server.", "#3fd1c6", True, "public", "_maritime"),
    (0, "Imagery footprints (STANAG 4545)", "Where the exercise's imagery was collected: NSIF image corner coordinates.", "#b38cff", False, "public", "_imagery"),
    (0, "Brigade S2 working estimate", "Private working overlay. Members join with the invite code.", "#e05d5d", False, "private", "_private"),
]


# ----------------------------------------------------------------------------------------------- load / remove
def state():
    return C.get_setting("demo", "never")  # "never" | "loaded" | "removed"


def ensure_loaded():
    """Call from the app's main data callables: loads the demo once, unless an admin removed it."""
    if state() == "never":
        load()


def load():
    from . import Drops, Feeds
    remove(remember=False)
    now = C.now()
    rnd = random.Random(26)
    users = []
    for name, email in DEMO_USERS:
        u = app_tables.users.get(email=email) or app_tables.users.add_row(email=email, enabled=False)
        u.update(display_name=name, is_demo=True, signed_up=now - dt.timedelta(days=40), bt_onboarded=True)
        users.append(u)
    builders = {"_blue_force": lambda: _blue_force(now, rnd), "_ops_overlay": lambda: _ops_overlay(now), "_opfor": lambda: _opfor(now, rnd),
                "_gmti": lambda: _gmti(now, rnd), "_fmv": lambda: _fmv(now, rnd), "_maritime": lambda: _maritime(now, rnd),
                "_imagery": lambda: _imagery(now), "_private": lambda: _private(now)}
    for owner, name, desc, color, featured, vis, build in FEEDS:
        f = Feeds.make_feed(users[owner], name, desc, visibility=vis, classification=EX, color=color, featured=featured,
                            is_demo=True, created=now - dt.timedelta(days=6))
        Feeds.subscribe(users[owner], f, is_demo=True)
        for filename, fmt, created, summary, feats in builders[build]():
            clean, _ = Drops.clean_features(feats)
            Drops.add_drop(f, users[owner], filename, fmt, summary, clean, created=created, is_demo=True)
    C.set_setting("demo", "loaded")
    return counts()


def remove(remember=True):
    for f in app_tables.feeds.search(is_demo=True):
        for s in app_tables.subscriptions.search(feed=f):
            s.delete()
        for d in app_tables.drops.search(feed=f):
            d.delete()
    for name in DEMO_TABLES:
        for r in getattr(app_tables, name).search(is_demo=True):
            r.delete()
    for u in app_tables.users.search(is_demo=True):
        u.delete()
    if remember:
        C.set_setting("demo", "removed")
    return counts()


def counts():
    out = {"users": len(app_tables.users.search(is_demo=True))}
    for name in DEMO_TABLES:
        out[name] = len(getattr(app_tables, name).search(is_demo=True))
    return out
