"""Drops: one parsed file (or push, or manual plot) added to a feed.

The browser parses every format (web/pages/_formats.html) into plain map features; the server never trusts
them: clean_features() checks every geometry, number, string and property before anything is stored.

A feature (JSON):
  g   "pt" point | "ln" line | "pg" polygon | "ci" circle (c = centre, r = radius in metres)
  c   [lat, lon] (pt, ci) or [[lat, lon], ...] (ln, pg)
  s   symbol id (SIDC), MIL-STD-2525 / APP-6 letter (15) or number (20/30) form
  n   label            id  track id (same id across drops = the same track: the map draws its trail)
  t   ISO time         m   1 = a moving-target dot (GMTI)     e  1 = ephemeral (only shown near its time)
  col "#rrggbb"        p   small dict of extra properties (speed, course, altitude, SNR ...)
"""
import datetime as dt
import math
import re

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C

MAX_FEATURES = 8000       # per drop
MAX_VERTICES = 2000       # per line / polygon
MAX_DROPS_PER_FEED = 500  # older drops are dropped first
FORMATS = {"4607": "STANAG 4607 GMTI", "4609": "STANAG 4609 FMV", "4545": "STANAG 4545 NSIF", "4676": "STANAG 4676 tracks",
           "nffi": "STANAG 5527 NFFI", "cot": "Cursor on Target", "nvg": "NATO Vector Graphics", "kml": "KML / KMZ",
           "geojson": "GeoJSON", "csv": "CSV", "ais": "AIS NMEA", "manual": "Manual plot", "other": "Other"}
SIDC_RX = re.compile(r"^[A-Z0-9\-\*]{10,30}$")
COLOR_RX = re.compile(r"^#[0-9a-fA-F]{6}$")


# ----------------------------------------------------------------------------------------------- cleaning
def _num(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        try:
            v = float(v)
        except (TypeError, ValueError):
            return None
    v = float(v)
    if math.isnan(v) or math.isinf(v) or v < lo or v > hi:
        return None
    return v


def _ll(c):
    if not isinstance(c, (list, tuple)) or len(c) < 2:
        return None
    lat, lon = _num(c[0], -90, 90), _num(c[1], -180, 180)
    if lat is None or lon is None:
        return None
    return [round(lat, 6), round(lon, 6)]


def parse_time(v):
    """ISO text -> aware datetime, or None."""
    if not isinstance(v, str) or not v.strip():
        return None
    s = v.strip()[:40].replace("Z", "+00:00").replace(" ", "T")
    s = re.sub(r"(\.\d{6})\d+", r"\1", s)  # Python wants at most 6 decimals
    try:
        d = dt.datetime.fromisoformat(s)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    if not (1970 <= d.year <= 2100):
        return None
    return d.astimezone(dt.timezone.utc)


def clean_props(p, depth=1):
    if not isinstance(p, dict):
        return {}
    out = {}
    for k, v in list(p.items())[:30]:
        k = C.text(k, 40)
        if not k:
            continue
        if isinstance(v, bool) or v is None:
            out[k] = v
        elif isinstance(v, (int, float)):
            if not (math.isnan(v) or math.isinf(v)):
                out[k] = round(v, 6) if isinstance(v, float) else v
        elif isinstance(v, str):
            out[k] = C.text(v, 300)
        elif isinstance(v, dict) and depth > 0:
            out[k] = clean_props(v, depth - 1)
        elif isinstance(v, list) and depth > 0:
            out[k] = [x if isinstance(x, (int, float, bool)) else C.text(x, 120) for x in v[:20]
                      if not isinstance(x, (dict, list))]
    return out


def clean_feature(f):
    if not isinstance(f, dict):
        return None
    g = f.get("g")
    out = {"g": g}
    c = f.get("c")
    if g in ("pt", "ci"):
        ll = _ll(c)
        if ll is None:
            return None
        out["c"] = ll
        if g == "ci":
            r = _num(f.get("r"), 1, 3e6)
            if r is None:
                return None
            out["r"] = round(r, 1)
    elif g in ("ln", "pg"):
        if not isinstance(c, (list, tuple)):
            return None
        pts = [p for p in (_ll(x) for x in list(c)[:MAX_VERTICES]) if p]
        if len(pts) < (2 if g == "ln" else 3):
            return None
        out["c"] = pts
    else:
        return None
    s = f.get("s")
    if isinstance(s, str) and SIDC_RX.match(s.strip().upper()):
        out["s"] = s.strip().upper()
    for key, limit in (("n", 80), ("id", 80)):
        v = C.text(f.get(key), limit)
        if v:
            out[key] = v
    t = parse_time(f.get("t"))
    if t is not None:
        out["t"] = t.isoformat().replace("+00:00", "Z")
    if f.get("m"):
        out["m"] = 1
    if f.get("e"):
        out["e"] = 1
    if isinstance(f.get("col"), str) and COLOR_RX.match(f["col"]):
        out["col"] = f["col"].lower()
    p = clean_props(f.get("p"))
    if p:
        out["p"] = p
    return out


def clean_features(features):
    """-> (clean list, how many were rejected)."""
    if not isinstance(features, (list, tuple)):
        return [], 0
    out, bad = [], 0
    for f in list(features)[:MAX_FEATURES]:
        cf = clean_feature(f)
        if cf is None:
            bad += 1
        else:
            out.append(cf)
    return out, bad + max(0, len(features) - MAX_FEATURES)


# ----------------------------------------------------------------------------------------------- storing
def add_drop(feed, uploader, filename, fmt, summary, features, source="upload", created=None, is_demo=False):
    """Store already-cleaned features as a new drop and update the feed's counters. Returns the row."""
    fmt = fmt if fmt in FORMATS else "other"
    stamp = created or C.now()
    times = [parse_time(f["t"]) for f in features if f.get("t")]
    row = app_tables.drops.add_row(feed=feed, uploader=uploader, filename=C.text(filename, 120) or "Untitled", fmt=fmt,
                                   source=source, summary=clean_props(summary, depth=2), features=features, n=len(features),
                                   data_end=max(times) if times else None, created=stamp, is_demo=bool(is_demo))
    formats = list(feed["formats"] or [])
    if fmt not in formats:
        formats.append(fmt)
    feed.update(n_drops=(feed["n_drops"] or 0) + 1, n_features=(feed["n_features"] or 0) + len(features),
                formats=formats, updated=max(stamp, feed["updated"] or stamp))
    _trim(feed)
    return row


def _trim(feed):
    if (feed["n_drops"] or 0) <= MAX_DROPS_PER_FEED:
        return
    rows = list(app_tables.drops.search(tables.order_by("created", ascending=False), feed=feed))
    for r in rows[MAX_DROPS_PER_FEED:]:
        _delete(r)


def _delete(drop):
    feed = drop["feed"]
    if feed is not None:
        feed.update(n_drops=max(0, (feed["n_drops"] or 1) - 1), n_features=max(0, (feed["n_features"] or 0) - (drop["n"] or 0)),
                    updated=C.now())
    drop.delete()


def drop_dict(d, me=None):
    feed = d["feed"]
    can = me is not None and (C.is_admin(me) or (feed is not None and feed["owner"] == me) or d["uploader"] == me)
    return {"id": d.get_id(), "filename": d["filename"], "fmt": d["fmt"], "fmt_label": FORMATS.get(d["fmt"], d["fmt"]),
            "source": d["source"], "n": d["n"] or 0, "summary": d["summary"] or {}, "created": C.iso(d["created"]),
            "data_end": C.iso(d["data_end"]), "by": C.name_of(d["uploader"]) if d["uploader"] else "Push endpoint",
            "can_delete": can, "demo": bool(d["is_demo"])}


def can_post(feed, me):
    return feed is not None and me is not None and (feed["owner"] == me or C.is_admin(me))


# ----------------------------------------------------------------------------------------------- callables
@anvil.server.callable(require_user=True)
def drop_publish(feed_id, filename, fmt, summary, features):
    """Add a parsed file to one of your feeds."""
    me = C.require_user()
    feed = C.row_by_id(app_tables.feeds, feed_id)
    if feed is None:
        return C.fail("That feed no longer exists.")
    if not can_post(feed, me):
        return C.fail("You can only publish to your own feeds.")
    if isinstance(summary, dict) and str(summary.get("classification", "")).upper() in ("SECRET", "TOP SECRET", "CONFIDENTIAL", "RESTRICTED"):
        return C.fail("Battle Tracker only accepts unclassified data. This file is marked %s." % summary["classification"])
    clean, bad = clean_features(features)
    if not clean:
        return C.fail("Nothing in that file could be placed on the map.")
    if C.rate_limited("drop_publish", 60, 3600):
        return C.fail("That's a lot of uploads in one hour. Please try again later.")
    row = add_drop(feed, me, filename, fmt, summary, clean)
    return C.ok(drop=drop_dict(row, me), kept=len(clean), rejected=bad)


@anvil.server.callable(require_user=True)
def drop_delete(drop_id):
    me = C.require_user()
    d = C.row_by_id(app_tables.drops, drop_id)
    if d is None:
        return C.ok()
    if not drop_dict(d, me)["can_delete"]:
        return C.fail("Only the feed's owner can delete this.")
    _delete(d)
    return C.ok()


@anvil.server.callable(require_user=True)
def drop_features(drop_id):
    """One drop's features (the feed page previews a drop on a small map)."""
    me = C.require_user()
    d = C.row_by_id(app_tables.drops, drop_id)
    if d is None:
        return C.fail("That drop no longer exists.")
    from . import Feeds
    if not Feeds.can_view(d["feed"], me):
        return C.fail("You don't have access to this feed.")
    return C.ok(drop=drop_dict(d, me), features=d["features"] or [])


@anvil.server.callable(require_user=True)
def plot_add(sidc, name, lat, lon, note=""):
    """Put one symbol on the map, in your private "My plots" feed."""
    me = C.require_user()
    f = clean_feature({"g": "pt", "c": [lat, lon], "s": sidc, "n": name, "t": C.now().isoformat(),
                       "p": {"note": C.text(note, 300)} if C.text(note, 300) else {}})
    if f is None:
        return C.fail("Pick a place on the map first.")
    if "s" not in f:
        return C.fail("That isn't a valid symbol code.")
    if C.rate_limited("plot_add", 120, 3600):
        return C.fail("That's a lot of plots in one hour. Please try again later.")
    from . import Feeds
    feed = Feeds.plots_feed(me)
    row = add_drop(feed, me, f.get("n") or "Plot", "manual", {"plotted": "by hand"}, [f], source="manual")
    return C.ok(drop=drop_dict(row, me), feed_id=feed.get_id())
