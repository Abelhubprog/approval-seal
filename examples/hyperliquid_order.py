"""Seal a Hyperliquid order intent, show tamper rejection, and map it to the
public orderStatus check. Offline by default: no network, no keys, no trading.

Run from the repo root:
    python3 examples/hyperliquid_order.py
    python3 examples/hyperliquid_order.py --lookup 0xWALLET OID_OR_CLOID   # one read-only public API call
"""
import copy
import json
import os
import sys
import time
import urllib.request
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from approval_seal import MemoryNonceStore, claim, hyperliquid_cloid, new_nonce, seal, verify  # noqa: E402

INFO_URL = "https://api.hyperliquid.xyz/info"


def order_status_request(wallet, oid_or_cloid):
    """The exact body to POST to /info. oid is an int, a cloid is a 0x + 32 hex string."""
    return {"type": "orderStatus", "user": wallet, "oid": oid_or_cloid}


def fetch_order_status(wallet, oid_or_cloid, url=INFO_URL):
    body = json.dumps(order_status_request(wallet, oid_or_cloid)).encode()
    req = urllib.request.Request(url, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def compare_order(action, status):
    """Compare a sealed order action to Hyperliquid's public record.

    Returns a list of (field, ok, detail). This checks what the public record
    shows (coin, side, size, limit price, status). It cannot show who clicked
    approve, and a partial fill still reports status "filled" with a smaller sz.
    """
    if status.get("status") != "order":
        return [("found", False, "Hyperliquid has no such order for this wallet (%s)" % status.get("status"))]
    o = status["order"]["order"]
    side = {"B": "buy", "A": "sell"}.get(o["side"])
    return [
        ("found", True, "oid %s, status %s" % (o["oid"], status["order"]["status"])),
        ("coin", o["coin"] == action["coin"], "%s vs %s" % (o["coin"], action["coin"])),
        ("side", side == action["side"], "%s vs %s" % (side, action["side"])),
        ("size", Decimal(o["origSz"]) == Decimal(action["size"]), "origSz %s vs %s" % (o["origSz"], action["size"])),
        ("limit_px", Decimal(o["limitPx"]) == Decimal(action["limit_px"]), "%s vs %s" % (o["limitPx"], action["limit_px"])),
        ("filled", status["order"]["status"] == "filled", status["order"]["status"]),
    ]


def main():
    if len(sys.argv) == 4 and sys.argv[1] == "--lookup":
        print(json.dumps(fetch_order_status(sys.argv[2], int(sys.argv[3]) if sys.argv[3].isdigit() else sys.argv[3]), indent=2))
        return

    # 1. The agent proposes an order. Sizes and prices are decimal STRINGS.
    action = {
        "kind": "order", "venue": "hyperliquid", "network": "mainnet",
        "account": "0x0000000000000000000000000000000000000001",
        "coin": "ETH", "side": "buy", "size": "0.0100", "limit_px": "2500.0",
        "tif": "Ioc", "reduce_only": False,
    }
    # 2. The owner approves. Your approval service seals and STORES the seal value.
    now = int(time.time())
    record = seal(action, "owner@example.test", now, new_nonce(), ttl_seconds=300)
    stored_seal = record["seal"]
    cloid = hyperliquid_cloid(record)
    print("sealed. action_hash:", record["action_hash"])
    print("seal:               ", stored_seal)
    print("cloid to put on the order:", cloid)

    # 3. The executor checks before sending anything to the venue.
    store = MemoryNonceStore()
    res = claim(record, store, expected_seal=stored_seal)
    print("\nexecutor claim #1:", "OK, execute" if res.ok else "REJECTED " + str(res.reason))
    res = claim(record, store, expected_seal=stored_seal)
    print("executor claim #2 (replay):", "OK" if res.ok else "REJECTED " + str(res.reason))

    # 4. Tamper: something changes the size after approval.
    bad = copy.deepcopy(record)
    bad["action"]["size"] = "10.0000"
    res = verify(bad, expected_seal=stored_seal)
    print("tampered size 0.0100 -> 10.0000:", "OK" if res.ok else "REJECTED " + str(res.reason) + " (" + res.detail + ")")

    # 5. After execution, anyone can ask Hyperliquid about the order. Use either
    #    the numeric oid from your order response, or the cloid set above.
    wallet = action["account"]
    print("\nPublic check (no login, no key):")
    print("  curl -s -X POST %s -H 'content-type: application/json' \\" % INFO_URL)
    print("    -d '%s'" % json.dumps(order_status_request(wallet, cloid)))

    # 6. Offline demo of compare_order() with a response shaped like the real API
    #    (captured from a public order, see README). Values edited to match this action.
    sample = {"status": "order", "order": {"status": "filled", "statusTimestamp": 1791718882393, "order": {
        "coin": "ETH", "side": "B", "limitPx": "2500.0", "sz": "0.0100", "oid": 571115389356,
        "timestamp": 1791718882393, "orderType": "Limit", "origSz": "0.0100", "tif": "Ioc", "cloid": cloid}}}
    print("\ncompare_order() against an EXAMPLE response shaped like the real API:")
    for name, ok, detail in compare_order(action, sample):
        print("  %-9s %s  %s" % (name, "ok " if ok else "NO ", detail))


if __name__ == "__main__":
    main()
