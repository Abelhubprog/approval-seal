"""Tests for examples/demo.py (the terminal demo). Offline only: --online is never used here."""
import contextlib
import importlib.util
import io
import os
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def load_demo():
    spec = importlib.util.spec_from_file_location("demo_example", os.path.join(ROOT, "examples", "demo.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run(mod, *argv):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = mod.main(list(argv))
    return code, buf.getvalue()


class DemoTests(unittest.TestCase):
    def setUp(self):
        self.demo = load_demo()

    def test_fixed_run_passes_and_covers_all_seven_steps(self):
        code, out = run(self.demo, "--fixed", "--no-color")
        self.assertEqual(code, 0)
        for n, title in enumerate(["Agent proposes", "Owner approves", "Anyone verifies", "Tamper",
                                   "Forge attempt", "Replay", "Check the public record"], 1):
            self.assertIn("[%d/7] %s" % (n, title), out)
        self.assertIn("All steps behaved as expected.", out)
        self.assertNotIn("UNEXPECTED", out)

    def test_fixed_output_is_identical_every_run(self):
        self.assertEqual(run(self.demo, "--fixed", "--no-color"), run(self.demo, "--fixed", "--no-color"))

    def test_fixed_values_match_the_published_example_in_the_readme(self):
        _, out = run(self.demo, "--fixed", "--no-color")
        self.assertIn("93fb66a910eb89ae1aa761b85c98acbae4f21c636464fb59d173618f661fd1b4", out)
        self.assertIn("09962d38b9b9f7815e54ec9dc04bbe4c49d6f583b7152175f2db6c1b4255a79c", out)

    def test_names_the_exact_field_that_changed(self):
        _, out = run(self.demo, "--fixed", "--no-color")
        self.assertIn("Field that changed: action.size", out)
        self.assertIn("Field that changed: action.venue", out)
        self.assertIn("FAIL  action_hash", out)
        self.assertIn("FAIL  expected_seal", out)
        self.assertIn("FAIL not_replayed", out)

    def test_colors_only_when_asked(self):
        _, plain = run(self.demo, "--fixed", "--no-color")
        _, colored = run(self.demo, "--fixed", "--color")
        self.assertNotIn("\033[", plain)
        self.assertIn("\033[32;1mPASS\033[0m", colored)
        self.assertIn("\033[31;1mFAIL\033[0m", colored)

    def test_unrandomized_run_still_passes(self):
        code, out = run(self.demo, "--no-color")
        self.assertEqual(code, 0)

    def test_offline_run_prints_the_lookup_recipe_and_makes_no_request(self):
        def boom(*a, **k):
            raise AssertionError("the offline demo must not touch the network")
        self.demo.order_status = boom
        code, out = run(self.demo, "--fixed", "--no-color")
        self.assertEqual(code, 0)
        self.assertIn("offline: skipped the public lookup", out)
        self.assertIn('"oid": "0x93fb66a910eb89ae1aa761b85c98acba"', out)

    def test_online_mode_with_a_stubbed_api(self):
        ex_ids = {"571115389356", "556494079751", "542140909470", "0x5048110c000013cd8f8d7bca8eef747b"}

        def fake(wallet, oid):
            if str(oid) in ex_ids:
                return {"status": "order", "order": {"status": "filled", "order": {"coin": "ETH", "side": "B", "limitPx": "1.0", "origSz": "2.0"}}}
            return {"status": "unknownOid"}
        self.demo.order_status = fake
        code, out = run(self.demo, "--fixed", "--no-color", "--online")
        self.assertEqual(code, 0)
        self.assertIn("4 of 4 receipts verified, no login", out)
        self.assertIn("derived id: NOT FOUND", out)

    def test_online_mode_never_counts_an_unfilled_order(self):
        def fake(wallet, oid):
            return {"status": "order", "order": {"status": "canceled", "order": {"coin": "ETH", "side": "B", "limitPx": "1", "origSz": "1"}}}
        self.demo.order_status = fake
        code, out = run(self.demo, "--fixed", "--no-color", "--online")
        self.assertEqual(code, 1)
        self.assertNotIn("receipts verified, no login", out)

    def test_network_failure_exits_2(self):
        def down(wallet, oid):
            raise OSError("no route")
        self.demo.order_status = down
        code, out = run(self.demo, "--fixed", "--no-color", "--online")
        self.assertEqual(code, 2)
        self.assertIn("could not reach", out)

    def test_exit_1_if_the_library_stops_catching_tampering(self):
        real = self.demo.verify

        class AlwaysOk(object):
            ok = True
            reason = None
            detail = ""
            checks = [("action_hash", True, "")]
        self.demo.verify = lambda *a, **k: AlwaysOk()
        code, out = run(self.demo, "--fixed", "--no-color")
        self.assertEqual(code, 1)
        self.assertIn("UNEXPECTED", out)
        self.demo.verify = real

    def test_unknown_flag_is_an_error(self):
        code, _ = run(self.demo, "--nope")
        self.assertEqual(code, 2)

    def test_readme_transcript_matches_the_real_offline_output(self):
        """The README transcript was made with --fixed --no-color --online. Steps 1 to 6 are deterministic, so compare them."""
        _, out = run(self.demo, "--fixed", "--no-color")
        head = out.split("[7/7]")[0].rstrip("\n")
        with open(os.path.join(ROOT, "README.md"), encoding="utf-8") as f:
            readme = f.read()
        self.assertTrue(head in readme, "README Demo transcript is out of date: regenerate it with examples/demo.py --fixed --no-color --online")


if __name__ == "__main__":
    unittest.main()
