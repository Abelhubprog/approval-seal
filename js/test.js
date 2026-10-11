// Run: node js/test.js   (Node 18+, no dependencies). Uses the same vectors as the Python tests.
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const AS = require("./approval-seal.js");
const V = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vectors", "test_vectors.json"), "utf8"));

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n     " + (e && e.message)); }
}
const clone = (x) => JSON.parse(JSON.stringify(x));

(async () => {
  for (const c of V.canonical_valid) {
    await t("canonical valid: " + c.name, () => assert.strictEqual(AS.canonicalize(AS.parseStrict(c.input_json)), c.expected));
  }
  for (const c of V.canonical_invalid) {
    await t("canonical invalid: " + c.name, () => assert.throws(() => AS.canonicalize(AS.parseStrict(c.input_json)), AS.CanonicalError));
  }
  await t("canonical rejects NaN and Infinity", () => {
    assert.throws(() => AS.canonicalize(NaN), AS.CanonicalError);
    assert.throws(() => AS.canonicalize(Infinity), AS.CanonicalError);
  });
  await t("published seal vector", async () => {
    const s = V.seal;
    const rec = await AS.seal(clone(s.action), s.approver, s.ts, s.nonce, s.ttl_seconds);
    assert.deepStrictEqual(rec, s.record);
  });
  for (const c of V.verify) {
    await t("verify vector: " + c.name, async () => {
      const r = await AS.verify(clone(c.record), { now: c.now, expectedSeal: c.expected_seal });
      assert.strictEqual(r.ok, c.expect_ok);
      assert.strictEqual(r.reason, c.expect_reason);
    });
  }
  await t("replayed nonce rejected by claim()", async () => {
    const store = new AS.MemoryNonceStore();
    const rec = clone(V.seal.record);
    const a = await AS.claim(rec, store, { now: V.seal.ts + 1 });
    const b = await AS.claim(rec, store, { now: V.seal.ts + 2 });
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.ok, false);
    assert.strictEqual(b.reason, "not_replayed");
  });
  await t("cloid matches Python vector", () => {
    assert.strictEqual(AS.hyperliquidCloid(V.seal.record), "0x" + V.seal.record.action_hash.slice(0, 32));
  });
  await t("garbage input does not throw", async () => {
    for (const j of [null, 1, "x", [], {}]) assert.strictEqual((await AS.verify(j, { now: 1 })).ok, false);
  });
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
