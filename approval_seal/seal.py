"""Seal an approved agent action, and verify it before executing.

A sealed record binds an action to an approver, a timestamp, a nonce and an
expiry using SHA-256 over canonical JSON. See README.md for the full spec and
the threat model. In short: this is tamper evidence plus expiry plus
single-use, not a signature and not proof of who approved.
"""

import hashlib
import secrets
import threading
import time

from .canonical import CanonicalError, canonical_bytes

VERSION = "approval-seal/1"
DEFAULT_TTL_SECONDS = 900
DEFAULT_SKEW_SECONDS = 300
MIN_NONCE_LEN = 8
MAX_NONCE_LEN = 128

_ACTION_PREFIX = b"approval-seal/1/action\n"
_SEAL_PREFIX = b"approval-seal/1/seal\n"

RECORD_KEYS = (
    "version", "action", "approver", "ts", "nonce", "expires_at",
    "action_hash", "seal",
)


class SealError(ValueError):
    """Inputs to seal() are invalid."""


def new_nonce():
    """A random 128-bit nonce as 32 hex characters."""
    return secrets.token_hex(16)


def _sha256_hex(prefix, data):
    return hashlib.sha256(prefix + data).hexdigest()


def action_hash(action):
    """SHA-256 over the domain prefix plus the canonical JSON of action."""
    return _sha256_hex(_ACTION_PREFIX, canonical_bytes(action))


def _seal_value(ahash, approver, ts, nonce, expires_at):
    payload = {
        "version": VERSION,
        "action_hash": ahash,
        "approver": approver,
        "ts": ts,
        "nonce": nonce,
        "expires_at": expires_at,
    }
    return _sha256_hex(_SEAL_PREFIX, canonical_bytes(payload))


def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def _check_fields(approver, ts, nonce, expires_at):
    if not isinstance(approver, str) or not approver:
        raise SealError("approver must be a non-empty string")
    if not _is_int(ts) or ts < 0:
        raise SealError("ts must be a non-negative integer (Unix seconds)")
    if not isinstance(nonce, str) or not (MIN_NONCE_LEN <= len(nonce) <= MAX_NONCE_LEN):
        raise SealError("nonce must be a string of %d to %d characters" % (MIN_NONCE_LEN, MAX_NONCE_LEN))
    if not _is_int(expires_at) or expires_at <= ts:
        raise SealError("expires_at must be an integer greater than ts")


def seal(action, approver, ts, nonce, ttl_seconds=DEFAULT_TTL_SECONDS):
    """Return a sealed record for action.

    action: a JSON-like value (see canonical.py). approver: a string naming who
    approved (a claim, not authenticated). ts: Unix seconds when approved.
    nonce: a unique string per approval (use new_nonce()).
    """
    if not _is_int(ttl_seconds) or ttl_seconds <= 0:
        raise SealError("ttl_seconds must be a positive integer")
    expires_at = ts + ttl_seconds if _is_int(ts) else None
    _check_fields(approver, ts, nonce, expires_at)
    try:
        ahash = action_hash(action)
    except CanonicalError as e:
        raise SealError("action is not canonicalizable: %s" % e)
    return {
        "version": VERSION,
        "action": action,
        "approver": approver,
        "ts": ts,
        "nonce": nonce,
        "expires_at": expires_at,
        "action_hash": ahash,
        "seal": _seal_value(ahash, approver, ts, nonce, expires_at),
    }


def hyperliquid_cloid(record_or_hash):
    """The 128-bit client order id derived from an action hash.

    Hyperliquid accepts a client order id (cloid) of 0x plus 32 hex characters
    on an order, and orderStatus accepts it in place of the numeric oid. If the
    executor sets this cloid when placing the order, the public order record
    carries a pointer back to the sealed action.
    """
    h = record_or_hash["action_hash"] if isinstance(record_or_hash, dict) else record_or_hash
    return "0x" + h[:32]


class VerifyResult(object):
    """Outcome of verify(). ok is True only if every check passed.

    reason is the first failing check name, or None. checks is an ordered list
    of (name, passed, detail) tuples, all computed even after a failure.
    """

    def __init__(self, checks):
        self.checks = checks
        failed = [c for c in checks if not c[1]]
        self.ok = not failed
        self.reason = failed[0][0] if failed else None
        self.detail = failed[0][2] if failed else ""

    def __bool__(self):
        return self.ok

    __nonzero__ = __bool__

    def __repr__(self):
        return "VerifyResult(ok=%r, reason=%r)" % (self.ok, self.reason)


def verify(record, now=None, expected_seal=None, skew_seconds=DEFAULT_SKEW_SECONDS):
    """Check a sealed record without consuming it.

    Checks, in order: well_formed, version, action_hash, seal, expected_seal
    (only if given), not_expired, not_from_future. Hash checks recompute from
    the record's own fields.

    expected_seal is the seal value your approval service stored at approval
    time. Without it, verify() only proves the record is self-consistent, which
    anyone could forge. With it, the record must be the exact one approved.
    """
    now = int(time.time()) if now is None else now
    checks = []

    def add(name, ok, detail=""):
        checks.append((name, bool(ok), "" if ok else detail))

    try:
        well = (
            isinstance(record, dict)
            and set(record.keys()) == set(RECORD_KEYS)
        )
        if well:
            _check_fields(record["approver"], record["ts"], record["nonce"], record["expires_at"])
            if not (isinstance(record["action_hash"], str) and isinstance(record["seal"], str)):
                raise SealError("hashes must be strings")
        add("well_formed", well, "record must have exactly the keys: " + ", ".join(RECORD_KEYS))
    except SealError as e:
        well = False
        add("well_formed", False, str(e))
    if not well:
        return VerifyResult(checks)

    add("version", record["version"] == VERSION, "unsupported version %r" % (record["version"],))
    try:
        ahash = action_hash(record["action"])
        add("action_hash", ahash == record["action_hash"], "action does not match action_hash")
    except CanonicalError as e:
        ahash = None
        add("action_hash", False, "action is not canonicalizable: %s" % e)
    sv = _seal_value(record["action_hash"], record["approver"], record["ts"], record["nonce"], record["expires_at"])
    add("seal", sv == record["seal"], "seal does not match the record fields")
    if expected_seal is not None:
        add("expected_seal", expected_seal == record["seal"], "record is not the one that was approved")
    add("not_expired", now <= record["expires_at"], "approval expired at %d (now %d)" % (record["expires_at"], now))
    add("not_from_future", record["ts"] <= now + skew_seconds, "approval timestamp is in the future")
    return VerifyResult(checks)


class MemoryNonceStore(object):
    """In-process single-use store. Swap in a database table for real use.

    add_if_absent must be atomic across all executors that share an approval.
    """

    def __init__(self):
        self._seen = {}
        self._lock = threading.Lock()

    def add_if_absent(self, key, expires_at, now):
        with self._lock:
            for k in [k for k, e in self._seen.items() if e < now]:
                del self._seen[k]
            if key in self._seen:
                return False
            self._seen[key] = expires_at
            return True


def claim(record, store, now=None, expected_seal=None, skew_seconds=DEFAULT_SKEW_SECONDS):
    """verify() and then consume the approval exactly once.

    Returns a VerifyResult. If every check passes but the (approver, nonce)
    pair was already used, the result has reason "not_replayed" failed, which
    means replay. Call this immediately before executing the action.
    """
    now = int(time.time()) if now is None else now
    res = verify(record, now=now, expected_seal=expected_seal, skew_seconds=skew_seconds)
    if not res.ok:
        return res
    key = "%s\n%s" % (record["approver"], record["nonce"])
    fresh = store.add_if_absent(key, record["expires_at"], now)
    checks = list(res.checks)
    checks.append(("not_replayed", fresh, "" if fresh else "this approval was already used (replay)"))
    return VerifyResult(checks)
