// Run: node test/verifier.test.js            (offline, uses saved fixtures and a mock fetch)
//      LIVE=1 node test/verifier.test.js      (also calls the real Hyperliquid public API once per receipt)
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert"), crypto = require("crypto");
const R = require("../receipts.js"), AS = require("../approval-seal.js");
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
const example = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "example-data.json"), "utf8"));
const W = example.wallet;

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log("ok   " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n     " + (e && e.stack || e)); } }

// Mock of the Hyperliquid info API built from saved real responses.
function mockFetch(log) {
  return async (url, init) => {
    const body = JSON.parse(init.body); log && log.push(body);
    let data, status = 200;
    if (body.type === "userFills") data = fx("userFills-subset.json");
    else if (body.type === "orderStatus") {
      if (body.oid === 571115389356 || body.oid === "0x5048110c000013cd8f8d7bca8eef747b") data = fx("orderStatus-filled-partial.json");
      else if (body.oid === 542140909470) data = fx("orderStatus-filled-full.json");
      else if (body.oid === 556494079751) data = fx("orderStatus-filled-eth.json");
      else if (body.oid === 7) data = fx("orderStatus-canceled-SYNTHETIC.json");
      else if (body.oid === 500) { status = 500; data = "boom"; }
      else data = fx("orderStatus-unknown.json");
    }
    return { ok: status === 200, status, text: async () => typeof data === "string" ? data : JSON.stringify(data) };
  };
}

(async () => {
  await t("isWallet", () => {
    assert(R.isWallet(W)); assert(!R.isWallet("0x123")); assert(!R.isWallet("")); assert(!R.isWallet(W + "00"));
  });
  await t("parseIds: oid, cloid, comments, dedupe, invalid", () => {
    const ids = R.parseIds("571115389356   # note\n0x5048110C000013CD8F8D7BCA8EEF747B, 571115389356\nabc\n\n12");
    assert.deepStrictEqual(ids.map(i => i.kind), ["oid", "cloid", "invalid", "oid"]);
    assert.strictEqual(ids[1].value, "0x5048110c000013cd8f8d7bca8eef747b");
  });
  await t("classify: filled (real response, partial fill)", () => {
    const v = R.classify(fx("orderStatus-filled-partial.json"));
    assert.strictEqual(v.state, "verified"); assert.strictEqual(v.order.coin, "ETH"); assert.strictEqual(v.order.side, "buy");
    assert.strictEqual(v.order.origSz, "0.2404");
  });
  await t("classify: unknownOid is not found", () => assert.strictEqual(R.classify(fx("orderStatus-unknown.json")).state, "not_found"));
  await t("classify: canceled is found but NOT verified", () => assert.strictEqual(R.classify(fx("orderStatus-canceled-SYNTHETIC.json")).state, "not_filled"));
  await t("classify: garbage is error", () => { for (const g of [null, 5, {}, { status: "weird" }]) assert.strictEqual(R.classify(g).state, "error"); });
  await t("summarizeFills adds up fills for one order", () => {
    const v = R.classify(fx("orderStatus-filled-partial.json"));
    const s = R.summarizeFills(fx("userFills-subset.json"), v.order);
    assert(s && s.count >= 1 && s.size > 0 && s.avgPx > 0);
  });
  await t("checkAll with example ids: all verified, summary says N of N", async () => {
    const ids = R.parseIds(example.receipts.map(r => r.id).join("\n"));
    const out = await R.checkAll(W, ids, { fetch: mockFetch() });
    const s = R.summarize(out.results);
    assert.strictEqual(s.text, "4 of 4 receipts verified, no login"); assert(s.allVerified);
  });
  await t("checkAll with a fake id: not N of N, says not found", async () => {
    const ids = R.parseIds(example.receipts.map(r => r.id).concat(example.fake_id_for_demo.id).join("\n"));
    const s = R.summarize((await R.checkAll(W, ids, { fetch: mockFetch() })).results);
    assert.strictEqual(s.text, "4 of 5 receipts verified (1 not found)"); assert(!s.allVerified);
  });
  await t("checkAll: canceled and HTTP error and invalid id are not counted", async () => {
    const ids = R.parseIds("7 500 abc 542140909470");
    const s = R.summarize((await R.checkAll(W, ids, { fetch: mockFetch() })).results);
    assert.strictEqual(s.verified, 1); assert.strictEqual(s.counts.not_filled, 1); assert.strictEqual(s.counts.error, 2);
  });
  await t("checkAll sends the right request bodies", async () => {
    const log = []; await R.checkAll(W.toUpperCase().replace("0X", "0x"), R.parseIds("571115389356 0x5048110c000013cd8f8d7bca8eef747b"), { fetch: mockFetch(log) });
    const os = log.filter(b => b.type === "orderStatus");
    assert.deepStrictEqual(os.map(b => typeof b.oid), ["number", "string"]);
    assert(os.every(b => b.user === W));
    assert(log.some(b => b.type === "userFills" && b.user === W));
  });
  await t("checkAll rejects bad wallet and too many ids", async () => {
    await assert.rejects(R.checkAll("nope", R.parseIds("1"), { fetch: mockFetch() }));
    const many = R.parseIds(Array.from({ length: 51 }, (_, i) => String(i + 1)).join(" "));
    await assert.rejects(R.checkAll(W, many, { fetch: mockFetch() }));
  });
  await t("summarize empty list", () => assert.strictEqual(R.summarize([]).text, "No receipts to check"));

  // Seal verify logic as the page uses it (client-side SHA-256 via WebCrypto; Node exposes the same API).
  // Works in the local layout (sibling approval-seal/ folder) and in the published layout (verifier/ inside the repo).
  const pick = (...c) => c.find(fs.existsSync);
  const vecPath = pick(path.join(__dirname, "..", "..", "approval-seal", "vectors", "test_vectors.json"), path.join(__dirname, "..", "..", "vectors", "test_vectors.json"));
  const libJs = pick(path.join(__dirname, "..", "..", "approval-seal", "js", "approval-seal.js"), path.join(__dirname, "..", "..", "js", "approval-seal.js"));
  const V = JSON.parse(fs.readFileSync(vecPath, "utf8"));
  await t("verifier's approval-seal.js is identical to the library's js/approval-seal.js", () => {
    const h = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    assert.strictEqual(h(path.join(__dirname, "..", "approval-seal.js")), h(libJs));
  });
  for (const c of V.verify) {
    await t("seal vector: " + c.name, async () => {
      const r = await AS.verify(JSON.parse(JSON.stringify(c.record)), { now: c.now, expectedSeal: c.expected_seal });
      assert.strictEqual(r.ok, c.expect_ok); assert.strictEqual(r.reason, c.expect_reason);
    });
  }
  await t("tamper demo as the page does it: size change is rejected, original passes", async () => {
    const now = Math.floor(Date.now() / 1000);
    const rec = await AS.seal({ kind: "order", venue: "hyperliquid", size: "0.0100" }, "owner@example.test", now, "abcdef0123456789", 900);
    assert.strictEqual((await AS.verify(rec, { expectedSeal: rec.seal })).ok, true);
    const bad = JSON.parse(JSON.stringify(rec)); bad.action.size = "10.0000";
    const r = await AS.verify(bad, { expectedSeal: rec.seal });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, "action_hash");
  });
  await t("forge demo as the page does it: passes alone, fails with expected seal", async () => {
    const now = Math.floor(Date.now() / 1000);
    const rec = await AS.seal({ size: "0.0100" }, "owner@example.test", now, "abcdef0123456789", 900);
    const f = JSON.parse(JSON.stringify(rec)); f.action.size = "10.0000";
    f.action_hash = await AS.actionHash(f.action);
    f.seal = (await AS.seal(f.action, f.approver, f.ts, f.nonce, f.expires_at - f.ts)).seal;
    assert.strictEqual((await AS.verify(f)).ok, true);
    const r = await AS.verify(f, { expectedSeal: rec.seal });
    assert.strictEqual(r.reason, "expected_seal");
  });
  await t("parseStrict rejects a float amount pasted into a record", () => {
    assert.throws(() => AS.parseStrict('{"action":{"size":0.01}}'), AS.CanonicalError);
  });

  if (process.env.LIVE) {
    await t("LIVE: example receipts verify against api.hyperliquid.xyz", async () => {
      const ids = R.parseIds(example.receipts.map(r => r.id).concat(example.fake_id_for_demo.id).join("\n"));
      const out = await R.checkAll(W, ids, { fetch: fetch });
      const s = R.summarize(out.results);
      console.log("     live summary: " + s.text + "; fills matched: " + out.results.map(r => r.fills ? r.fills.count : 0).join(","));
      assert.strictEqual(s.verified, 4); assert.strictEqual(s.counts.not_found, 1);
    });
  }
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
