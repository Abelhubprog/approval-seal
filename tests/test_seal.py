import copy
import hashlib
import json
import os
import unittest

from approval_seal import (
    CanonicalError, MemoryNonceStore, SealError, action_hash, canonicalize,
    claim, hyperliquid_cloid, new_nonce, seal, verify,
)

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "..", "vectors", "test_vectors.json")) as f:
    V = json.load(f)

ACTION = V["seal"]["action"]
TS = V["seal"]["ts"]
NONCE = V["seal"]["nonce"]


def fresh():
    return seal(copy.deepcopy(ACTION), "owner@example.test", TS, NONCE, 900)


class CanonicalTests(unittest.TestCase):
    def test_valid_vectors(self):
        for c in V["canonical_valid"]:
            with self.subTest(c["name"]):
                self.assertEqual(canonicalize(json.loads(c["input_json"])), c["expected"])

    def test_matches_stdlib_json_for_the_subset(self):
        for c in V["canonical_valid"]:
            with self.subTest(c["name"]):
                v = json.loads(c["input_json"])
                std = json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
                self.assertEqual(canonicalize(v), std)

    def test_invalid_vectors(self):
        for c in V["canonical_invalid"]:
            with self.subTest(c["name"]):
                with self.assertRaises(CanonicalError):
                    canonicalize(json.loads(c["input_json"]))

    def test_rejects_non_json_types(self):
        for bad in (b"bytes", (1, 2), {1, 2}, float("nan"), float("inf"), {1: "x"}, object()):
            with self.subTest(repr(bad)):
                with self.assertRaises(CanonicalError):
                    canonicalize(bad)

    def test_bool_is_not_an_integer(self):
        self.assertEqual(canonicalize([True, 1, False, 0]), "[true,1,false,0]")

    def test_key_order_does_not_matter(self):
        self.assertEqual(canonicalize({"a": 1, "b": 2}), canonicalize({"b": 2, "a": 1}))


class SealTests(unittest.TestCase):
    def test_published_vector(self):
        s = V["seal"]
        rec = seal(s["action"], s["approver"], s["ts"], s["nonce"], s["ttl_seconds"])
        self.assertEqual(rec, s["record"])

    def test_action_hash_is_plain_sha256_of_prefix_and_canonical_json(self):
        text = json.dumps(ACTION, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        expect = hashlib.sha256(b"approval-seal/1/action\n" + text.encode("ascii")).hexdigest()
        self.assertEqual(action_hash(ACTION), expect)

    def test_roundtrip_through_json_text(self):
        rec = json.loads(json.dumps(fresh()))
        self.assertTrue(verify(rec, now=TS + 1).ok)

    def test_bad_inputs(self):
        for kw in (
            dict(approver="", ts=TS, nonce=NONCE),
            dict(approver="a", ts=-1, nonce=NONCE),
            dict(approver="a", ts=1.5, nonce=NONCE),
            dict(approver="a", ts=TS, nonce="short"),
            dict(approver="a", ts=True, nonce=NONCE),
        ):
            with self.subTest(kw):
                with self.assertRaises(SealError):
                    seal(ACTION, **kw)
        with self.assertRaises(SealError):
            seal({"size": 0.01}, "a", TS, NONCE)  # float rejected
        with self.assertRaises(SealError):
            seal(ACTION, "a", TS, NONCE, ttl_seconds=0)

    def test_new_nonce_is_unique_and_valid(self):
        a, b = new_nonce(), new_nonce()
        self.assertNotEqual(a, b)
        self.assertEqual(len(a), 32)

    def test_cloid_shape(self):
        c = hyperliquid_cloid(fresh())
        self.assertRegex(c, r"^0x[0-9a-f]{32}$")
        self.assertEqual(c, "0x" + fresh()["action_hash"][:32])


class VectorVerifyTests(unittest.TestCase):
    def test_all_verify_vectors(self):
        for c in V["verify"]:
            with self.subTest(c["name"]):
                res = verify(c["record"], now=c["now"], expected_seal=c.get("expected_seal"))
                self.assertEqual(res.ok, c["expect_ok"])
                self.assertEqual(res.reason, c["expect_reason"])


class TamperRejectionTests(unittest.TestCase):
    def test_untouched_record_passes(self):
        self.assertTrue(verify(fresh(), now=TS + 1).ok)

    def test_changed_amount_is_rejected(self):
        rec = fresh()
        rec["action"]["size"] = "100.0000"
        res = verify(rec, now=TS + 1)
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, "action_hash")

    def test_changed_venue_is_rejected(self):
        rec = fresh()
        rec["action"]["venue"] = "somewhere-else"
        res = verify(rec, now=TS + 1)
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, "action_hash")

    def test_changed_amount_with_recomputed_action_hash_is_rejected(self):
        rec = fresh()
        rec["action"]["size"] = "100.0000"
        rec["action_hash"] = action_hash(rec["action"])
        res = verify(rec, now=TS + 1)
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, "seal")

    def test_full_recompute_forgery_needs_expected_seal(self):
        approved = fresh()
        forged = fresh()
        forged["action"]["size"] = "100.0000"
        forged["action_hash"] = action_hash(forged["action"])
        forged["seal"] = seal(forged["action"], forged["approver"], forged["ts"], forged["nonce"], 900)["seal"]
        self.assertTrue(verify(forged, now=TS + 1).ok)  # self-consistent: documented limit
        res = verify(forged, now=TS + 1, expected_seal=approved["seal"])
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, "expected_seal")

    def test_expired_approval_is_rejected(self):
        res = verify(fresh(), now=TS + 901)
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, "not_expired")
        self.assertTrue(verify(fresh(), now=TS + 900).ok)

    def test_replayed_nonce_is_rejected(self):
        store = MemoryNonceStore()
        rec = fresh()
        first = claim(rec, store, now=TS + 1)
        self.assertTrue(first.ok)
        second = claim(rec, store, now=TS + 2)
        self.assertFalse(second.ok)
        self.assertEqual(second.reason, "not_replayed")

    def test_same_nonce_on_a_different_action_is_rejected(self):
        store = MemoryNonceStore()
        self.assertTrue(claim(fresh(), store, now=TS + 1).ok)
        other_action = copy.deepcopy(ACTION)
        other_action["size"] = "0.0200"
        other = seal(other_action, "owner@example.test", TS, NONCE, 900)
        res = claim(other, store, now=TS + 2)
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, "not_replayed")

    def test_same_nonce_from_another_approver_is_independent(self):
        store = MemoryNonceStore()
        self.assertTrue(claim(fresh(), store, now=TS + 1).ok)
        other = seal(ACTION, "someone-else@example.test", TS, NONCE, 900)
        self.assertTrue(claim(other, store, now=TS + 2).ok)

    def test_failed_verification_does_not_consume_the_nonce(self):
        store = MemoryNonceStore()
        bad = fresh()
        bad["action"]["size"] = "9.0000"
        self.assertFalse(claim(bad, store, now=TS + 1).ok)
        self.assertTrue(claim(fresh(), store, now=TS + 2).ok)

    def test_expired_record_is_not_claimable(self):
        store = MemoryNonceStore()
        res = claim(fresh(), store, now=TS + 5000)
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, "not_expired")

    def test_garbage_input_does_not_crash(self):
        for junk in (None, 1, "x", [], {}, {"version": "approval-seal/1"}):
            with self.subTest(repr(junk)):
                self.assertFalse(verify(junk, now=TS).ok)

    def test_unserializable_action_inside_record_is_rejected_not_raised(self):
        rec = fresh()
        rec["action"]["size"] = 0.01
        res = verify(rec, now=TS + 1)
        self.assertFalse(res.ok)
        self.assertEqual(res.reason, "action_hash")


if __name__ == "__main__":
    unittest.main()
