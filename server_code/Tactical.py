"""The map: every feed you subscribe to, with its latest drops, in one call. map_version is the cheap poll."""
import hashlib

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import DemoData, Drops, Feeds

DROPS_PER_FEED = 60
MAX_MAP_FEATURES = 40000


def _onboard(me):
    """First visit to the map: subscribe to the featured public feeds, so the map isn't empty."""
    if me["bt_onboarded"]:
        return
    for f in app_tables.feeds.search(featured=True, visibility="public"):
        Feeds.subscribe(me, f, is_demo=bool(f["is_demo"]))
    me["bt_onboarded"] = True


def _subs(me):
    return [s for s in app_tables.subscriptions.search(user=me) if s["feed"] is not None]


@anvil.server.callable(require_user=True)
def map_get():
    me = C.require_user()
    DemoData.ensure_loaded()
    _onboard(me)
    feeds, drops, total = [], [], 0
    for s in _subs(me):
        f = s["feed"]
        feeds.append(Feeds.feed_dict(f, me, s))
        for d in app_tables.drops.search(tables.order_by("created", ascending=False), feed=f)[:DROPS_PER_FEED]:
            if total >= MAX_MAP_FEATURES:
                break
            feats = d["features"] or []
            total += len(feats)
            dd = Drops.drop_dict(d, me)
            dd.pop("summary", None)
            dd["feed"] = f.get_id()
            dd["features"] = feats
            drops.append(dd)
    feeds.sort(key=lambda x: (x["kind"] != "plots", x["name"].lower()))
    return {"feeds": feeds, "drops": drops, "version": _version(me), "truncated": total >= MAX_MAP_FEATURES}


def _version(me):
    parts = sorted("%s:%s:%s" % (s["feed"].get_id(), C.iso(s["feed"]["updated"]), s["shown"]) for s in _subs(me))
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]


@anvil.server.callable(require_user=True)
def map_version():
    """Changes whenever a subscribed feed gets new data (the map polls this every 20 seconds)."""
    me = C.require_user()
    return {"version": _version(me), "server_time": C.iso(C.now())}
