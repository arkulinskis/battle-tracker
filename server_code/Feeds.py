"""Feeds: named streams of map data that people publish to and subscribe to.

visibility "public"  listed in the catalog, anyone signed in can subscribe
           "private" hidden; only the owner, and people who join with the invite code
kind       "feed" (normal) | "plots" (each person's own "My plots" feed, made on first plot)
Every feed has an ingest key: other systems POST CoT or GeoJSON to /_/api/ingest/<key> (Ingest.py).
"""
import secrets

import anvil.server
from anvil.tables import app_tables
import anvil.tables as tables

from . import common as C
from . import Drops

COLORS = ["#ff7a2f", "#f2b646", "#4fb3ff", "#7ad18c", "#e05d5d", "#b38cff", "#3fd1c6", "#d9d4c7"]
CLASSIFICATIONS = ["UNCLASSIFIED", "UNCLASSIFIED // EXERCISE", "UNCLASSIFIED // FOR TRAINING", "UNCLASSIFIED // SIMULATED",
                   "NATO UNCLASSIFIED", "PUBLIC RELEASE"]


def new_key():
    return "bt_" + secrets.token_urlsafe(18)


def new_code():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(4)) + "-" + "".join(secrets.choice(alphabet) for _ in range(4))


def sub_of(feed, me):
    if me is None or feed is None:
        return None
    return app_tables.subscriptions.get(user=me, feed=feed)


def can_view(feed, me):
    if feed is None or me is None:
        return False
    return feed["visibility"] == "public" or feed["owner"] == me or C.is_admin(me) or sub_of(feed, me) is not None


def feed_dict(f, me, sub=None, full=False):
    mine = me is not None and f["owner"] == me
    d = {"id": f.get_id(), "name": f["name"], "description": f["description"] or "", "kind": f["kind"] or "feed",
         "visibility": f["visibility"], "classification": f["classification"] or "UNCLASSIFIED", "color": f["color"] or COLORS[0],
         "owner": C.name_of(f["owner"]), "mine": mine, "featured": bool(f["featured"]), "drops": f["n_drops"] or 0,
         "features": f["n_features"] or 0, "formats": list(f["formats"] or []), "created": C.iso(f["created"]),
         "updated": C.iso(f["updated"]), "subscribed": sub is not None, "shown": bool(sub["shown"]) if sub is not None else False,
         "demo": bool(f["is_demo"])}
    if full:
        d["subscribers"] = len(app_tables.subscriptions.search(feed=f))
    if mine or (full and C.is_admin(me)):
        d["invite_code"] = f["invite_code"]
        d["ingest_key"] = f["ingest_key"]
    return d


def make_feed(owner, name, description="", visibility="public", classification="UNCLASSIFIED", color=None, kind="feed",
              featured=False, is_demo=False, created=None):
    stamp = created or C.now()
    f = app_tables.feeds.add_row(owner=owner, name=name, description=description, kind=kind, visibility=visibility,
                                 classification=classification, color=color or COLORS[len(app_tables.feeds.search()) % len(COLORS)],
                                 invite_code=new_code(), ingest_key=new_key(), featured=featured, n_drops=0, n_features=0,
                                 formats=[], created=stamp, updated=stamp, is_demo=is_demo)
    return f


def subscribe(user, feed, is_demo=False):
    s = sub_of(feed, user)
    if s is None:
        s = app_tables.subscriptions.add_row(user=user, feed=feed, shown=True, created=C.now(), is_demo=is_demo)
    return s


def remove_feed(feed):
    for s in app_tables.subscriptions.search(feed=feed):
        s.delete()
    for d in app_tables.drops.search(feed=feed):
        d.delete()
    feed.delete()


def plots_feed(me):
    f = app_tables.feeds.get(owner=me, kind="plots")
    if f is None:
        f = make_feed(me, "My plots", "Symbols you placed on the map by hand. Only you see them.", visibility="private",
                      classification="UNCLASSIFIED", color="#f2b646", kind="plots")
        subscribe(me, f)
    return f


def _fields(data):
    """Validate the editable fields of a feed: -> (dict, error)."""
    data = data if isinstance(data, dict) else {}
    out = {}
    if "name" in data:
        name = C.text(data.get("name"), 80)
        if len(name) < 3:
            return None, "Give the feed a name (at least 3 characters)."
        out["name"] = name
    if "description" in data:
        out["description"] = C.text(data.get("description"), 600, multiline=True)
    if "visibility" in data:
        if data.get("visibility") not in ("public", "private"):
            return None, "Visibility is public or private."
        out["visibility"] = data["visibility"]
    if "classification" in data:
        c = C.text(data.get("classification"), 60).upper()
        if c not in CLASSIFICATIONS:
            return None, "Battle Tracker is for unclassified data only: pick one of the unclassified markings."
        out["classification"] = c
    if "color" in data:
        if data.get("color") not in COLORS:
            return None, "Pick one of the feed colours."
        out["color"] = data["color"]
    return out, None


def _owned(feed_id, me):
    f = C.row_by_id(app_tables.feeds, feed_id)
    if f is None:
        return None, C.fail("That feed no longer exists.")
    if f["owner"] != me and not C.is_admin(me):
        return None, C.fail("Only the feed's owner can do that.")
    return f, None


# ----------------------------------------------------------------------------------------------- callables
@anvil.server.callable(require_user=True)
def feeds_catalog(query=None):
    """The feeds page: your subscriptions, your feeds, and public feeds to discover."""
    me = C.require_user()
    query = C.text(query, 80).lower()
    subs = {s["feed"].get_id(): s for s in app_tables.subscriptions.search(user=me) if s["feed"] is not None}
    rows = [f for f in app_tables.feeds.search(tables.order_by("updated", ascending=False))
            if f["visibility"] == "public" or f["owner"] == me or f.get_id() in subs]
    if query:
        rows = [f for f in rows if query in (f["name"] or "").lower() or query in (f["description"] or "").lower()
                or any(query in Drops.FORMATS.get(x, x).lower() for x in (f["formats"] or []))]
    return {"feeds": [feed_dict(f, me, subs.get(f.get_id())) for f in rows[:200]],
            "colors": COLORS, "classifications": CLASSIFICATIONS, "formats": Drops.FORMATS}


@anvil.server.callable(require_user=True)
def feed_get(feed_id):
    me = C.require_user()
    f = C.row_by_id(app_tables.feeds, feed_id)
    if f is None or not can_view(f, me):
        return C.fail("That feed doesn't exist, or it's private.")
    drops = app_tables.drops.search(tables.order_by("created", ascending=False), feed=f)
    return C.ok(feed=feed_dict(f, me, sub_of(f, me), full=True), drops=[Drops.drop_dict(d, me) for d in drops[:100]],
                total=len(drops), colors=COLORS, classifications=CLASSIFICATIONS)


@anvil.server.callable(require_user=True)
def my_feeds():
    """Feeds you can publish to (the upload page)."""
    me = C.require_user()
    rows = app_tables.feeds.search(tables.order_by("updated", ascending=False), owner=me)
    return {"feeds": [feed_dict(f, me) for f in rows if (f["kind"] or "feed") == "feed"],
            "colors": COLORS, "classifications": CLASSIFICATIONS}


@anvil.server.callable(require_user=True)
def feed_create(data):
    me = C.require_user()
    fields, err = _fields(dict({"visibility": "public", "classification": "UNCLASSIFIED", "color": COLORS[0]}, **(data or {})))
    if err:
        return C.fail(err)
    if "name" not in fields:
        return C.fail("Give the feed a name (at least 3 characters).")
    if C.rate_limited("feed_create", 20, 3600):
        return C.fail("That's a lot of new feeds in one hour. Please try again later.")
    f = make_feed(me, **fields)
    subscribe(me, f)
    return C.ok(feed=feed_dict(f, me, sub_of(f, me), full=True))


@anvil.server.callable(require_user=True)
def feed_update(feed_id, data):
    me = C.require_user()
    f, err = _owned(feed_id, me)
    if err:
        return err
    fields, msg = _fields(data)
    if msg:
        return C.fail(msg)
    if (f["kind"] or "feed") == "plots":
        fields.pop("visibility", None)
    f.update(**fields)
    return C.ok(feed=feed_dict(f, me, sub_of(f, me), full=True))


@anvil.server.callable(require_user=True)
def feed_delete(feed_id):
    me = C.require_user()
    f, err = _owned(feed_id, me)
    if err:
        return err
    remove_feed(f)
    return C.ok()


@anvil.server.callable(require_user=True)
def feed_rotate(feed_id, which):
    """New ingest key or invite code (the old one stops working)."""
    me = C.require_user()
    f, err = _owned(feed_id, me)
    if err:
        return err
    if which == "ingest":
        f["ingest_key"] = new_key()
    elif which == "invite":
        f["invite_code"] = new_code()
    else:
        return C.fail("Unknown key.")
    return C.ok(feed=feed_dict(f, me, sub_of(f, me), full=True))


@anvil.server.callable(require_user=True)
def feed_subscribe(feed_id):
    me = C.require_user()
    f = C.row_by_id(app_tables.feeds, feed_id)
    if f is None:
        return C.fail("That feed no longer exists.")
    if f["visibility"] != "public" and f["owner"] != me and not C.is_admin(me):
        return C.fail("That feed is private: ask its owner for the invite code.")
    s = subscribe(me, f)
    return C.ok(feed=feed_dict(f, me, s))


@anvil.server.callable(require_user=True)
def feed_unsubscribe(feed_id):
    me = C.require_user()
    f = C.row_by_id(app_tables.feeds, feed_id)
    s = sub_of(f, me) if f is not None else None
    if s is not None:
        s.delete()
    return C.ok(feed=feed_dict(f, me) if f is not None else None)


@anvil.server.callable(require_user=True)
def feed_join(code):
    """Subscribe to a private feed with its invite code."""
    me = C.require_user()
    code = C.text(code, 20).upper().replace(" ", "")
    if len(code) == 8 and "-" not in code:
        code = code[:4] + "-" + code[4:]
    if C.rate_limited("feed_join", 20, 3600):
        return C.fail("Too many tries. Please wait a while.")
    f = app_tables.feeds.get(invite_code=code) if len(code) == 9 else None
    if f is None or (f["kind"] or "feed") == "plots":
        return C.fail("No feed has that invite code. Check it with the feed's owner.")
    s = subscribe(me, f)
    return C.ok(feed=feed_dict(f, me, s))


@anvil.server.callable(require_user=True)
def feed_show(feed_id, shown):
    """Show or hide a subscribed feed on the map (remembered)."""
    me = C.require_user()
    f = C.row_by_id(app_tables.feeds, feed_id)
    s = sub_of(f, me) if f is not None else None
    if s is None:
        return C.fail("You're not subscribed to that feed.")
    s["shown"] = bool(shown)
    return C.ok()
