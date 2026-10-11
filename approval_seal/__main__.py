"""Command line: python -m approval_seal {canonical,seal,verify} ..."""

import argparse
import json
import sys
import time

from . import canonicalize, seal, verify, new_nonce, hyperliquid_cloid, SealError, CanonicalError


def _load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main(argv=None):
    p = argparse.ArgumentParser(prog="approval_seal")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("canonical", help="print canonical JSON for a file")
    c.add_argument("file")

    s = sub.add_parser("seal", help="seal an action file, print the record")
    s.add_argument("action_file")
    s.add_argument("--approver", required=True)
    s.add_argument("--ts", type=int, default=None, help="Unix seconds, default now")
    s.add_argument("--nonce", default=None, help="default random")
    s.add_argument("--ttl", type=int, default=900, help="seconds, default 900")

    v = sub.add_parser("verify", help="verify a sealed record file; exit 0 ok, 1 rejected")
    v.add_argument("record_file")
    v.add_argument("--expected-seal", default=None)
    v.add_argument("--now", type=int, default=None, help="Unix seconds, default now")

    a = p.parse_args(argv)
    try:
        if a.cmd == "canonical":
            print(canonicalize(_load(a.file)))
            return 0
        if a.cmd == "seal":
            ts = int(time.time()) if a.ts is None else a.ts
            rec = seal(_load(a.action_file), a.approver, ts, a.nonce or new_nonce(), a.ttl)
            print(json.dumps(rec, indent=2, sort_keys=True))
            return 0
        rec = _load(a.record_file)
        res = verify(rec, now=a.now, expected_seal=a.expected_seal)
        for name, ok, detail in res.checks:
            print("%-16s %s%s" % (name, "ok" if ok else "FAIL", "" if ok else "  " + detail))
        if res.ok:
            print("VERIFIED")
            if isinstance(rec, dict) and isinstance(rec.get("action_hash"), str):
                print("hyperliquid cloid: " + hyperliquid_cloid(rec))
            return 0
        print("REJECTED: " + str(res.reason))
        return 1
    except (SealError, CanonicalError, OSError, ValueError) as e:
        print("error: %s" % e, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
