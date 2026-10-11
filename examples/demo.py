"""Terminal demo of approval-seal: the same 7 steps as the guided page.

    python3 examples/demo.py              # offline, steps 1 to 6 plus the public-lookup recipe
    python3 examples/demo.py --online     # also checks real public Hyperliquid orders (read-only, no login)
    python3 examples/demo.py --fixed      # fixed time and nonce, so the output is the same on every run
    python3 examples/demo.py --no-color   # plain text (also automatic when piped or when NO_COLOR is set)

Everything is EXAMPLE DATA. The sample order is never sent anywhere. The only network
calls (with --online) are read-only POSTs to Hyperliquid's public info endpoint.
Exit code 0 if every step behaved as expected, 1 if not, 2 if the network lookup failed.
"""
import copy
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from approval_seal import MemoryNonceStore, claim, hyperliquid_cloid, new_nonce, seal, verify  # noqa: E402

INFO_URL = "https://api.hyperliquid.xyz/info"
FIXED_TS = 1790000000
FIXED_NONCE = "0123456789abcdef0123456789abcdef"
TOTAL = 7


class Out(object):
    def __init__(self, color):
        self.color = color
        self.problems = []

    def c(self, code, text):
        return "\033[%sm%s\033[0m" % (code, text) if self.color else text

    def green(self, t): return self.c("32;1", t)
    def red(self, t): return self.c("31;1", t)
    def yellow(self, t): return self.c("33;1", t)
    def dim(self, t): return self.c("2", t)
    def bold(self, t): return self.c("1", t)

    def step(self, n, title):
        print("\n" + self.bold("[%d/%d] %s" % (n, TOTAL, title)))

    def line(self, text=""):
        print("  " + text)

    def checks(self, res):
        for name, ok, detail in res.checks:
            tag = self.green("PASS") if ok else self.red("FAIL")
            self.line(("%s  %-16s%s" % (tag, name, "" if ok else "  " + detail)).rstrip())

    def expect(self, cond, good, bad):
        """Print the outcome line. A step that did not behave as expected is recorded as a problem."""
        if cond:
            self.line(self.green(good))
        else:
            self.line(self.red("UNEXPECTED: " + bad))
            self.problems.append(bad)


def changed_fields(a, b, prefix=""):
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            out += changed_fields(a.get(k), b.get(k), prefix + "." + k if prefix else k)
    elif a != b:
        out.append((prefix, a, b))
    return out


def order_status(wallet, oid):
    body = json.dumps({"type": "orderStatus", "user": wallet, "oid": oid}).encode()
    req = urllib.request.Request(INFO_URL, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def verdict(resp):
    """Only an order that Hyperliquid reports as filled counts as verified."""
    if resp.get("status") == "order":
        o = resp["order"]["order"]
        return ("verified" if resp["order"]["status"] == "filled" else "not_filled", o, resp["order"]["status"])
    return ("not_found", None, resp.get("status"))


def main(argv=None):
    args = set(sys.argv[1:] if argv is None else argv)
    unknown = args - {"--online", "--fixed", "--no-color", "--color", "-h", "--help"}
    if unknown or "-h" in args or "--help" in args:
        print(__doc__)
        return 0 if not unknown else 2
    color = "--color" in args or (sys.stdout.isatty() and not os.environ.get("NO_COLOR") and "--no-color" not in args)
    o = Out(color)

    ts = FIXED_TS if "--fixed" in args else int(time.time())
    nonce = FIXED_NONCE if "--fixed" in args else new_nonce()
    now = ts + 60 if "--fixed" in args else None   # None means the real clock

    print(o.bold("approval-seal demo") + o.dim("  (EXAMPLE DATA, no trade is placed, nothing is sent anywhere)"))

    # 1. The agent proposes. Sizes and prices are decimal strings, never floats.
    o.step(1, "Agent proposes")
    with open(os.path.join(HERE, "order.json")) as f:
        action = json.load(f)
    for ln in json.dumps(action, indent=2).splitlines():
        o.line(ln)
    o.line(o.dim("A proposal only. Nothing is signed."))

    # 2. The owner approves. The seal is stored separately, as an approval service would keep it.
    o.step(2, "Owner approves")
    record = seal(action, "owner@example.test", ts, nonce, ttl_seconds=900)
    stored_seal = record["seal"]
    o.line("action_hash  " + record["action_hash"])
    o.line("approver     %s   ts %d   nonce %s   expires_at %d" % (record["approver"], record["ts"], record["nonce"], record["expires_at"]))
    o.line("seal         " + stored_seal)
    o.line(o.dim("The seal is saved separately as the stored seal. The approver is just a name: no signature."))

    # 3. Anyone verifies.
    o.step(3, "Anyone verifies")
    res = verify(record, now=now, expected_seal=stored_seal)
    o.checks(res)
    o.expect(res.ok, "VERIFIED: unchanged since sealing, matches the stored seal, not expired", "the genuine record was rejected: %s" % res.reason)

    # 4. Tamper: change one field after approval.
    o.step(4, "Tamper")
    for field, new in (("size", "10.0000"), ("venue", "other-exchange.example")):
        bad = copy.deepcopy(record)
        bad["action"][field] = new
        o.line(o.bold("edit: action.%s %s -> %s" % (field, record["action"][field], new)))
        res = verify(bad, now=now, expected_seal=stored_seal)
        o.checks(res)
        o.expect(not res.ok and res.reason == "action_hash",
                 "REJECTED: action_hash (as expected). Field that changed: %s" % ", ".join(c[0] for c in changed_fields(record["action"], bad["action"], "action")),
                 "a tampered %s was not caught by action_hash (got %s)" % (field, res.reason))

    # 5. Forge: edit the amount AND recompute action_hash and seal, so the record is self-consistent.
    o.step(5, "Forge attempt")
    forged = seal(dict(record["action"], size="10.0000"), record["approver"], record["ts"], record["nonce"], record["expires_at"] - record["ts"])
    alone = verify(forged, now=now)
    o.line("recomputed hashes for action.size 10.0000")
    o.line("forged record on its own (no stored seal): " + (o.yellow("PASS, but only self-consistent. Anyone can recompute hashes.") if alone.ok else o.red("REJECTED " + str(alone.reason))))
    against = verify(forged, now=now, expected_seal=stored_seal)
    o.checks(against)
    o.line("stored seal  " + stored_seal)
    o.line("forged seal  " + forged["seal"])
    o.expect(alone.ok and not against.ok and against.reason == "expected_seal",
             "REJECTED: expected_seal (as expected). The forgery cannot match the seal stored at approval time.",
             "forgery handling was not as expected (alone ok=%s, against reason=%s)" % (alone.ok, against.reason))

    # 6. Replay: claim the same approval twice.
    o.step(6, "Replay")
    store = MemoryNonceStore()
    first = claim(record, store, now=now, expected_seal=stored_seal)
    second = claim(record, store, now=now, expected_seal=stored_seal)
    o.line("claim 1: " + (o.green("PASS") if first.ok else o.red("FAIL " + str(first.reason))) + "  the executor may run the order once")
    o.line("claim 2: " + (o.green("PASS") if second.ok else o.red("FAIL " + str(second.reason))) + "  same approval again")
    o.expect(first.ok and not second.ok and second.reason == "not_replayed",
             "REJECTED: not_replayed (as expected). One approval, one use.",
             "replay handling was not as expected (first ok=%s, second reason=%s)" % (first.ok, second.reason))

    # 7. Public record.
    o.step(7, "Check the public record")
    cloid = hyperliquid_cloid(record)
    with open(os.path.join(HERE, "..", "verifier", "example-data.json")) as f:
        ex = json.load(f)
    o.line("client order id derived from the sealed action: " + cloid)
    o.line(o.dim("(0x plus the first 32 hex characters of action_hash; set it on a real order and the public record points back here)"))
    o.line(o.dim("EXAMPLE DATA: the example receipts are real public orders from a third-party wallet, not PROWZI receipts."))
    exit_code = 0
    if "--online" not in args:
        o.line("offline: skipped the public lookup. Add --online to run it, or by hand:")
        o.line("curl -s -X POST %s -H 'content-type: application/json' \\" % INFO_URL)
        o.line("  -d '%s'" % json.dumps({"type": "orderStatus", "user": ex["wallet"], "oid": cloid}))
    else:
        verified = 0
        try:
            for r in ex["receipts"]:
                oid = int(r["id"]) if r["id"].isdigit() else r["id"]
                state, order, status = verdict(order_status(ex["wallet"], oid))
                if state == "verified":
                    verified += 1
                    side = {"B": "buy", "A": "sell"}.get(order["side"], order["side"])
                    o.line("%s  %s  %s %s %s limit %s" % (o.green("VERIFIED"), r["id"], side, order["origSz"], order["coin"], order["limitPx"]))
                else:
                    o.line("%s  %s  %s" % (o.red(state.upper()), r["id"], status))
            total = len(ex["receipts"])
            if verified == total:
                o.line(o.green("%d of %d receipts verified, no login" % (verified, total)))
            else:
                o.line(o.red("%d of %d receipts verified" % (verified, total)))
                o.problems.append("not every example receipt verified")
            state, _, _ = verdict(order_status(ex["wallet"], cloid))
            o.expect(state == "not_found", "derived id: NOT FOUND (as expected: the sample order was never sent to Hyperliquid)",
                     "the derived id was found on Hyperliquid (%s)" % state)
        except (OSError, ValueError) as e:
            o.line(o.red("could not reach Hyperliquid's public API: %s" % e))
            exit_code = 2

    print()
    print(o.dim("What this proves: the order is unchanged since sealing, was not replayed, and public orders can be checked with no login."))
    print(o.dim("What it does not prove: who approved (no signature in 0.1.0), or profit, or safety. Not an audit."))
    if o.problems:
        print(o.red("FAILED: %d step(s) did not behave as expected" % len(o.problems)))
        return 1
    if exit_code == 0:
        print(o.green("All steps behaved as expected."))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
