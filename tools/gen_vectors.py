"""Regenerate vectors/test_vectors.json from the Python implementation.

The expected values are then checked by BOTH test suites (Python and JS) and,
for canonical output, against the standard library json module. Review the diff
if you ever need to regenerate: a change means the wire format changed.
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from approval_seal import canonicalize, seal, verify  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

valid = [
    ("null", "null"), ("true", "true"), ("false", "false"), ("zero", "0"),
    ("negative int", "-42"), ("max safe int", "9007199254740991"),
    ("empty object", "{}"), ("empty array", "[]"),
    ("key order", '{"b":1,"a":2,"B":3}'),
    ("whitespace removed", '{ "a" : [ 1 , 2 ] , "b" : { "c" : null } }'),
    ("nested sort", '{"z":{"y":1,"x":2},"a":[{"d":1,"c":2}]}'),
    ("string escapes", '"quote\\" backslash\\\\ nl\\n tab\\t bs\\b ff\\f cr\\r"'),
    ("control char", '"\\u0001\\u001f"'),
    ("del is escaped", '"\\u007f"'),
    ("non-ascii escaped lowercase", '"caf\\u00e9 \\u00C9"'),
    ("astral becomes surrogate pair", '"\\ud83d\\ude00"'),
    ("astral raw utf8 input", '"\U0001F600"'),
    ("keys sorted by code point not utf16", '{"\\ud83d\\ude00":1,"\\uffee":2}'),
    ("decimal strings stay strings", '{"size":"0.0100","px":"2500.0"}'),
    ("slash is not escaped", '"a/b"'),
]
invalid = [
    ("float", "1.5"), ("float with zero fraction", "1.0"), ("exponent", "1e3"),
    ("integer above 2**53-1", "9007199254740992"),
    ("negative integer below -(2**53-1)", "-9007199254740992"),
    ("float inside object", '{"size":0.01}'),
    ("lone high surrogate", '"\\ud800"'), ("lone low surrogate", '"\\udc00"'),
    ("too deep", "[" * 70 + "]" * 70),
]

BASE_ACTION = {
    "kind": "order", "venue": "hyperliquid", "network": "mainnet",
    "account": "0x0000000000000000000000000000000000000001",
    "coin": "ETH", "side": "buy", "size": "0.0100", "limit_px": "2500.0",
    "tif": "Ioc", "reduce_only": False,
}
TS = 1790000000
NONCE = "0123456789abcdef0123456789abcdef"
rec = seal(BASE_ACTION, "owner@example.test", TS, NONCE, 900)

def mutate(fn):
    r = copy.deepcopy(rec)
    fn(r)
    return r

cases = []
def add(name, record, now, expect_ok, expect_reason, expected_seal=None, note=""):
    res = verify(record, now=now, expected_seal=expected_seal)
    assert res.ok == expect_ok and res.reason == expect_reason, (name, res)
    c = {"name": name, "record": record, "now": now, "expect_ok": expect_ok,
         "expect_reason": expect_reason}
    if expected_seal is not None:
        c["expected_seal"] = expected_seal
    if note:
        c["note"] = note
    cases.append(c)

add("untouched record", rec, TS + 10, True, None)
add("untouched, with expected seal", rec, TS + 10, True, None, expected_seal=rec["seal"])
add("changed amount", mutate(lambda r: r["action"].update(size="1.0000")), TS + 10, False, "action_hash")
add("changed venue", mutate(lambda r: r["action"].update(venue="binance")), TS + 10, False, "action_hash")
add("changed network", mutate(lambda r: r["action"].update(network="testnet")), TS + 10, False, "action_hash")
add("added field", mutate(lambda r: r["action"].update(leverage=20)), TS + 10, False, "action_hash")
add("changed approver", mutate(lambda r: r.update(approver="attacker@example.test")), TS + 10, False, "seal")
add("changed ts", mutate(lambda r: r.update(ts=TS + 5)), TS + 10, False, "seal")
add("changed nonce", mutate(lambda r: r.update(nonce="ffffffffffffffffffffffffffffffff")), TS + 10, False, "seal")
add("extended expiry", mutate(lambda r: r.update(expires_at=TS + 999999)), TS + 5000, False, "seal")
add("expired approval", rec, TS + 901, False, "not_expired")
add("exactly at expiry is still valid", rec, TS + 900, True, None)

def reforge(r):
    r["action"]["size"] = "1.0000"
    from approval_seal import action_hash
    r["action_hash"] = action_hash(r["action"])
add("action changed and action_hash recomputed (seal not)", mutate(reforge), TS + 10, False, "seal")

def full_forge(r):
    from approval_seal import action_hash
    from approval_seal.seal import _seal_value
    r["action"]["size"] = "1.0000"
    r["action_hash"] = action_hash(r["action"])
    r["seal"] = _seal_value(r["action_hash"], r["approver"], r["ts"], r["nonce"], r["expires_at"])
forged = mutate(full_forge)
add("full forgery passes without expected_seal", forged, TS + 10, True, None,
    note="Shows why verify() alone is not enough: anyone can recompute the hashes.")
add("full forgery rejected with expected_seal", forged, TS + 10, False, "expected_seal", expected_seal=rec["seal"])
add("approval from the future", rec, TS - 1000, False, "not_from_future")
add("unknown extra key", mutate(lambda r: r.update(extra=1)), TS + 10, False, "well_formed")
add("missing key", mutate(lambda r: r.pop("nonce")), TS + 10, False, "well_formed")
add("wrong version", mutate(lambda r: r.update(version="approval-seal/2")), TS + 10, False, "version")

out = {
    "format": "approval-seal test vectors v1",
    "note": "Generated by tools/gen_vectors.py. Checked by tests/test_seal.py and js/test.js.",
    "canonical_valid": [{"name": n, "input_json": t, "expected": canonicalize(json.loads(t))} for n, t in valid],
    "canonical_invalid": [{"name": n, "input_json": t} for n, t in invalid],
    "seal": {"action": BASE_ACTION, "approver": "owner@example.test", "ts": TS, "nonce": NONCE,
             "ttl_seconds": 900, "record": rec},
    "verify": cases,
}
with open(os.path.join(HERE, "..", "vectors", "test_vectors.json"), "w") as f:
    json.dump(out, f, indent=2, sort_keys=True)
    f.write("\n")
print("wrote", len(valid), "valid,", len(invalid), "invalid,", len(cases), "verify cases")
