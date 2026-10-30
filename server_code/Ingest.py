"""Push ingest: other systems send live data to a feed without a browser.

    POST https://<app>/_/api/ingest/<ingest key>      body: CoT XML (one <event> or many) or GeoJSON
    optional ?name=label  (the drop's name in the feed)

The key comes from the feed page (owner only). A GET on the same URL answers with how to use it.
ingest_test() runs the same parser from the feed page, to try it out.
"""
import json
import re
import xml.etree.ElementTree as ET

import anvil.server
from anvil.tables import app_tables

from . import common as C
from . import Drops

MAX_BODY = 2 * 1024 * 1024
PUSHES_PER_10_MIN = 120
AFFIL = {"f": "F", "h": "H", "n": "N", "u": "U", "p": "P", "a": "A", "s": "S", "j": "J", "k": "K", "o": "U", "x": "U"}


def cot_to_sidc(cot_type):
    """CoT atom type (a-f-G-U-C-I) -> MIL-STD-2525 letter SIDC (SFGPUCI-----). Non-atoms -> None."""
    parts = (cot_type or "").split("-")
    if len(parts) < 3 or parts[0] != "a":
        return None
    aff = AFFIL.get(parts[1].lower(), "U")
    dim = parts[2].upper() if parts[2].upper() in "PAGSUF" and len(parts[2]) == 1 else "G"
    func = "".join(parts[3:]).upper()[:6]
    if not re.match(r"^[A-Z0-9]*$", func):
        func = ""
    return "S" + aff + dim + "P" + func.ljust(6, "-") + "-----"


def _local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_cot(root):
    events = [root] if _local(root.tag) == "event" else [e for e in root.iter() if _local(e.tag) == "event"]
    out = []
    for ev in events[:Drops.MAX_FEATURES]:
        pt = next((c for c in ev if _local(c.tag) == "point"), None)
        if pt is None:
            continue
        lat, lon = _f(pt.get("lat")), _f(pt.get("lon"))
        detail = next((c for c in ev if _local(c.tag) == "detail"), None)
        name, props = None, {"cot": ev.get("type", ""), "how": ev.get("how", "")}
        hae = _f(pt.get("hae"))
        if hae is not None and abs(hae) < 9e6:
            props["hae_m"] = hae
        if ev.get("stale"):
            props["stale"] = ev.get("stale")
        if detail is not None:
            for c in detail.iter():
                tag = _local(c.tag)
                if tag == "contact" and c.get("callsign"):
                    name = c.get("callsign")
                elif tag == "track":
                    if _f(c.get("course")) is not None:
                        props["course"] = _f(c.get("course"))
                    if _f(c.get("speed")) is not None:
                        props["speed_ms"] = _f(c.get("speed"))
                elif tag == "remarks" and (c.text or "").strip():
                    props["remarks"] = c.text.strip()
                elif tag == "__group" and c.get("name"):
                    props["team"] = c.get("name")
        uid = ev.get("uid") or ""
        out.append({"g": "pt", "c": [lat, lon], "s": cot_to_sidc(ev.get("type")) or "SUGP-----------", "n": name or uid,
                    "id": uid, "t": ev.get("time") or ev.get("start"), "p": props})
    return out


def _gj_props(p):
    p = p if isinstance(p, dict) else {}
    pick = lambda *keys: next((p[k] for k in keys if p.get(k) not in (None, "")), None)  # noqa: E731
    return {"s": pick("sidc", "SIDC", "symbol", "symbolCode", "sic"), "n": pick("name", "title", "label", "callsign", "designation"),
            "t": pick("time", "timestamp", "datetime", "dtg", "when"), "id": pick("id", "uid", "track", "trackId"),
            "p": {k: v for k, v in p.items() if isinstance(v, (str, int, float, bool)) and k not in ("sidc", "SIDC", "symbol", "name")}}


def parse_geojson(obj):
    feats = obj.get("features") if obj.get("type") == "FeatureCollection" else [obj] if obj.get("type") == "Feature" else []
    out = []
    for f in (feats or [])[:Drops.MAX_FEATURES]:
        if not isinstance(f, dict):
            continue
        geom, base = f.get("geometry") or {}, _gj_props(f.get("properties"))
        if base["id"] is None and f.get("id") is not None:
            base["id"] = str(f.get("id"))
        gtype, coords = geom.get("type"), geom.get("coordinates")
        flip = lambda c: [c[1], c[0]] if isinstance(c, (list, tuple)) and len(c) >= 2 else None  # noqa: E731
        shapes = []
        if gtype == "Point":
            shapes = [("pt", flip(coords))]
        elif gtype == "MultiPoint":
            shapes = [("pt", flip(c)) for c in coords or []]
        elif gtype == "LineString":
            shapes = [("ln", [flip(c) for c in coords or []])]
        elif gtype == "MultiLineString":
            shapes = [("ln", [flip(c) for c in line]) for line in coords or []]
        elif gtype == "Polygon":
            shapes = [("pg", [flip(c) for c in (coords or [[]])[0]])]
        elif gtype == "MultiPolygon":
            shapes = [("pg", [flip(c) for c in (poly or [[]])[0]]) for poly in coords or []]
        for g, c in shapes:
            out.append(dict(base, g=g, c=c))
    return out


def parse_text(text):
    """-> (features, fmt) or raises ValueError with a readable message."""
    s = (text or "").strip()
    if s.startswith("<"):
        try:
            root = ET.fromstring(s)
        except ET.ParseError as e:
            raise ValueError("The XML doesn't parse: %s" % e)
        feats = parse_cot(root)
        if not feats:
            raise ValueError("No CoT <event> with a <point> was found.")
        return feats, "cot"
    if s.startswith("{") or s.startswith("["):
        try:
            obj = json.loads(s)
        except ValueError as e:
            raise ValueError("The JSON doesn't parse: %s" % e)
        if isinstance(obj, dict) and obj.get("type") in ("FeatureCollection", "Feature"):
            return parse_geojson(obj), "geojson"
        if isinstance(obj, dict) and isinstance(obj.get("features"), list):
            return obj["features"], "other"   # Battle Tracker's own feature format
        if isinstance(obj, list):
            return obj, "other"
        raise ValueError("JSON must be GeoJSON (a Feature or FeatureCollection).")
    raise ValueError("Send CoT XML or GeoJSON.")


def push(feed, text, name=None, uploader=None):
    """Parse + store. -> C.ok / C.fail."""
    if len(text or "") > MAX_BODY:
        return C.fail("That's too big: pushes are limited to 2 MB.")
    recent = [d for d in app_tables.drops.search(feed=feed, source="push")
              if d["created"] and (C.now() - d["created"]).total_seconds() < 600]
    if len(recent) >= PUSHES_PER_10_MIN:
        return C.fail("Too many pushes: at most %d every 10 minutes per feed." % PUSHES_PER_10_MIN)
    try:
        raw, fmt = parse_text(text)
    except ValueError as e:
        return C.fail(str(e))
    clean, bad = Drops.clean_features(raw)
    if not clean:
        return C.fail("Nothing in that push could be placed on the map (check the coordinates).")
    label = C.text(name, 80) or ("Push %s" % C.now().strftime("%H:%M:%SZ"))
    row = Drops.add_drop(feed, uploader, label, fmt, {"source": "push", "bytes": len(text)}, clean, source="push")
    return C.ok(drop_id=row.get_id(), kept=len(clean), rejected=bad, fmt=fmt)


def _reply(status, data):
    return anvil.server.HttpResponse(status, json.dumps(data), headers={"Content-Type": "application/json"})


@anvil.server.http_endpoint("/ingest/:key", methods=["GET", "POST"])
def ingest(key, **params):
    feed = app_tables.feeds.get(ingest_key=key) if isinstance(key, str) and key.startswith("bt_") and len(key) < 60 else None
    if feed is None:
        return _reply(404, {"ok": False, "error": "Unknown ingest key."})
    req = anvil.server.request
    if (getattr(req, "method", "POST") or "POST").upper() == "GET":
        return _reply(200, {"ok": True, "feed": feed["name"], "usage": "POST CoT XML or GeoJSON to this URL. Optional ?name=label."})
    body = req.body
    data = body.get_bytes() if hasattr(body, "get_bytes") else (body or b"")
    if isinstance(data, str):
        data = data.encode("utf-8")
    if len(data) > MAX_BODY:
        return _reply(413, {"ok": False, "error": "Pushes are limited to 2 MB."})
    r = push(feed, data.decode("utf-8", errors="replace"), params.get("name"))
    return _reply(200 if r.get("ok") else 400, r)


@anvil.server.callable(require_user=True)
def ingest_test(feed_id, text):
    """The feed page's "try a push" box: same parser and rules as the endpoint."""
    me = C.require_user()
    feed = C.row_by_id(app_tables.feeds, feed_id)
    if feed is None:
        return C.fail("That feed no longer exists.")
    if not Drops.can_post(feed, me):
        return C.fail("Only the feed's owner can push to it.")
    return push(feed, C.text(text, MAX_BODY, multiline=True), "Test push", uploader=me)
