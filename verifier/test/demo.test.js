// Run: node test/demo.test.js   (offline: a mock fetch built from saved real responses)
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const R = require("../receipts.js"), AS = require("../approval-seal.js"), DS = require("../demo-steps.js");
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
const example = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "example-data.json"), "utf8"));

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log("ok   " + name); } catch (e) { fail++; console.log("FAIL " + name + "\n     " + (e && e.stack || e)); } }

function mockFetch(log) {
  return async (url, init) => {
    const body = JSON.parse(init.body); log && log.push(body);
    let data;
    if (body.type === "userFills") data = fx("userFills-subset.json");
    else if (body.oid === 571115389356 || body.oid === "0x5048110c000013cd8f8d7bca8eef747b") data = fx("orderStatus-filled-partial.json");
    else if (body.oid === 542140909470) data = fx("orderStatus-filled-full.json");
    else if (body.oid === 556494079751) data = fx("orderStatus-filled-eth.json");
    else data = fx("orderStatus-unknown.json");
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
}

const T0 = 1790000000;
function make(over) {
  const log = [];
  const d = DS.create(Object.assign({
    AS, R, fetch: mockFetch(log), example, now: () => T0 + 5, nonce: () => "0123456789abcdef0123456789abcdef", ttl: 900
  }, over || {}));
  d.log = log; return d;
}

(async () => {
  await t("step list has the seven steps in order", () => {
    assert.deepStrictEqual(DS.STEPS.map(s => s.id), ["propose", "approve", "verify", "tamper", "forge", "replay", "public"]);
  });

  await t("1 propose: example order as JSON, string amounts, no real wallet", () => {
    const d = make(), r = d.propose();
    assert.strictEqual(r.action.size, "0.0100"); assert.strictEqual(typeof r.action.limit_px, "string");
    assert.strictEqual(r.action.account, "0x0000000000000000000000000000000000000001");
    assert.deepStrictEqual(JSON.parse(r.json), r.action);
    assert(d.isDone("propose"));
  });

  await t("propose returns a copy: editing it does not change the demo's action", async () => {
    const d = make(), r = d.propose(); r.action.size = "999";
    const a = await d.approve();
    assert.strictEqual(a.record.action.size, "0.0100");
  });

  await t("steps cannot run out of order", async () => {
    const d = make();
    await assert.rejects(d.approve(), /Agent proposes/);
    d.propose();
    for (const f of ["verify", "forge", "replay", "checkPublic"]) await assert.rejects(d[f](), /Owner approves/, f);
    await assert.rejects(d.tamper("amount"), /Owner approves/);
  });

  await t("2 approve: action_hash, approval fields, seal, cloid, deterministic with injected clock and nonce", async () => {
    const d2 = make(); d2.propose(); const r = await d2.approve();
    assert(/^[0-9a-f]{64}$/.test(r.actionHash)); assert(/^[0-9a-f]{64}$/.test(r.seal));
    assert.strictEqual(r.approval.ts, T0 + 5); assert.strictEqual(r.approval.expires_at, T0 + 905);
    assert.strictEqual(r.approval.nonce, "0123456789abcdef0123456789abcdef");
    assert.strictEqual(r.cloid, "0x" + r.actionHash.slice(0, 32));
    assert.strictEqual(r.actionHash, await AS.actionHash(DS.EXAMPLE_ACTION));
    const again = make(); again.propose(); assert.strictEqual((await again.approve()).seal, r.seal);
  });

  await t("3 verify: green, every check passes, against the stored seal", async () => {
    const d = make(); d.propose(); await d.approve();
    const res = await d.verify();
    assert.strictEqual(res.ok, true);
    assert(res.checks.some(c => c.name === "expected_seal" && c.ok));
    assert(res.checks.every(c => c.ok));
    assert(d.isDone("verify"));
  });

  await t("3 verify: red after the approval expires", async () => {
    let clock = T0;
    const d = make({ now: () => clock }); d.propose(); await d.approve();
    clock = T0 + 901;
    const res = await d.verify();
    assert.strictEqual(res.ok, false); assert.strictEqual(res.reason, "not_expired");
  });

  await t("4 tamper amount: action_hash fails and the field is named", async () => {
    const d = make(); d.propose(); await d.approve();
    const r = await d.tamper("amount");
    assert.strictEqual(r.result.ok, false); assert.strictEqual(r.result.reason, "action_hash");
    assert.deepStrictEqual(r.failed, ["action_hash"]);
    assert.deepStrictEqual(r.changes, [{ path: "action.size", from: "0.0100", to: "10.0000" }]);
    assert.strictEqual(r.record.action.size, "10.0000");
  });

  await t("4 tamper venue: action_hash fails and the field is named", async () => {
    const d = make(); d.propose(); await d.approve();
    const r = await d.tamper("venue");
    assert.strictEqual(r.result.reason, "action_hash");
    assert.strictEqual(r.changes.length, 1); assert.strictEqual(r.changes[0].path, "action.venue");
    assert.strictEqual(r.changes[0].from, "hyperliquid"); assert.notStrictEqual(r.changes[0].to, "hyperliquid");
  });

  await t("4 tamper: unknown kind throws, and tampering never touches the approved record", async () => {
    const d = make(); d.propose(); const a = await d.approve();
    await assert.rejects(d.tamper("nope"), /Unknown tamper/);
    await d.tamper("amount"); await d.tamper("venue");
    const res = await d.verify();
    assert.strictEqual(res.ok, true);
  });

  await t("5 forge: passes alone, fails against the stored seal on expected_seal only", async () => {
    const d = make(); d.propose(); const a = await d.approve();
    const r = await d.forge();
    assert.strictEqual(r.withoutStored.ok, true);
    assert.strictEqual(r.withStored.ok, false); assert.strictEqual(r.withStored.reason, "expected_seal");
    assert.deepStrictEqual(r.failed, ["expected_seal"]);
    assert.notStrictEqual(r.forgedSeal, a.seal); assert.strictEqual(r.originalSeal, a.seal);
    assert.notStrictEqual(r.record.action_hash, a.actionHash);
    assert.strictEqual(r.changes[0].path, "action.size");
  });

  await t("6 replay: first claim accepted, second rejected as not_replayed", async () => {
    const d = make(); d.propose(); await d.approve();
    const r = await d.replay();
    assert.strictEqual(r.first.ok, true);
    assert.strictEqual(r.second.ok, false); assert.strictEqual(r.second.reason, "not_replayed");
  });

  await t("6 replay: running it again starts from a fresh store (demo can be repeated)", async () => {
    const d = make(); d.propose(); await d.approve();
    await d.replay(); const r = await d.replay();
    assert.strictEqual(r.first.ok, true); assert.strictEqual(r.second.reason, "not_replayed");
  });

  await t("7 public: 4 of 4 receipts verified, no login; derived cloid is not found", async () => {
    const d = make(); d.propose(); const a = await d.approve();
    const r = await d.checkPublic();
    assert.strictEqual(r.summary.text, "4 of 4 receipts verified, no login");
    assert.strictEqual(r.summary.allVerified, true);
    assert.strictEqual(r.cloid, a.cloid);
    assert.strictEqual(r.derived.state, "not_found");
    assert.strictEqual(r.wallet, example.wallet);
    // it asked the public API for the derived cloid, in the right wire format
    const asked = d.log.filter(b => b.type === "orderStatus" && b.oid === a.cloid);
    assert.strictEqual(asked.length, 1); assert.strictEqual(asked[0].user, example.wallet);
    // read-only: only the two public info request types
    assert(d.log.every(b => b.type === "orderStatus" || b.type === "userFills"));
    assert(d.isDone("public"));
  });

  await t("7 public: a network failure is shown as errors, never as verified", async () => {
    const boom = async () => { throw new Error("offline"); };
    const d = make({ fetch: boom }); d.propose(); await d.approve();
    const r = await d.checkPublic();
    assert.strictEqual(r.summary.allVerified, false);
    assert(r.summary.text.indexOf("could not be checked") >= 0);
  });

  await t("7 public: missing example data is an error", async () => {
    const d = make({ example: null }); d.propose(); await d.approve();
    await assert.rejects(d.checkPublic(), /Example data/);
  });

  await t("reset clears progress and locks later steps again", async () => {
    const d = make(); d.propose(); await d.approve(); await d.verify();
    d.reset();
    assert(DS.STEPS.every(s => !d.isDone(s.id)));
    await assert.rejects(d.approve(), /Agent proposes/);
  });

  await t("re-approving gives a new record; the old stored seal is replaced", async () => {
    let n = 0;
    const d = make({ nonce: () => "nonce-number-" + (++n) });
    d.propose(); const a1 = await d.approve(); const a2 = await d.approve();
    assert.notStrictEqual(a1.seal, a2.seal);
    assert.strictEqual((await d.verify()).ok, true);
  });

  await t("diffFields: nested paths, added and removed keys, equal values give nothing", () => {
    assert.deepStrictEqual(DS.diffFields({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 }, d: 4 }, "x"),
      [{ path: "x.b.c", from: 2, to: 3 }, { path: "x.d", from: undefined, to: 4 }]);
    assert.deepStrictEqual(DS.diffFields({ a: 1 }, { a: 1 }), []);
    assert.deepStrictEqual(DS.diffFields({ a: 1 }, {}), [{ path: "a", from: 1, to: undefined }]);
  });

  await t("EXAMPLE_ACTION matches examples/order.json used by the CLI and Python demo", () => {
    const o = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "examples", "order.json"), "utf8"));
    assert.deepStrictEqual(DS.EXAMPLE_ACTION, o);
  });

  const root = path.join(__dirname, "..", "..");
  await t("docs/ is an exact copy of verifier/ for every shipped page file", () => {
    for (const f of ["index.html", "app.js", "demo.js", "demo-steps.js", "receipts.js", "approval-seal.js", "example-data.json"]) {
      assert.strictEqual(fs.readFileSync(path.join(root, "docs", f), "utf8"), fs.readFileSync(path.join(root, "verifier", f), "utf8"), f);
    }
  });

  await t("page markup: Demo is the first tab and selected; seven steps; every script file exists", () => {
    const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
    const tabs = [...html.matchAll(/role="tab" id="tab-(\w+)" aria-selected="(\w+)"/g)].map(m => [m[1], m[2]]);
    assert.deepStrictEqual(tabs, [["demo", "true"], ["receipts", "false"], ["seal", "false"]]);
    for (let i = 1; i <= 7; i++) assert(html.includes('id="step-' + i + '"'), "step " + i);
    for (const m of html.matchAll(/<script src="([^"]+)"/g)) assert(fs.existsSync(path.join(root, "docs", m[1])), m[1]);
    assert(!/<script[^>]+src="https?:/.test(html), "no external scripts");
    assert(!/<link[^>]+href="https?:/.test(html), "no external stylesheets");
    assert(html.includes("EXAMPLE DATA"));
  });

  await t("every id the demo script looks up exists in the page", () => {
    const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
    const js = fs.readFileSync(path.join(root, "docs", "demo.js"), "utf8");
    const ids = new Set([...js.matchAll(/\$\("([\w-]+)"\)/g)].map(m => m[1]));
    ["do-1","do-2","do-3","do-4a","do-4b","do-5","do-6","do-7"].forEach(x => ids.add(x));
    for (let i = 1; i <= 7; i++) { ids.add("step-" + i); ids.add("out-" + i); ids.add("step-" + i + "-h"); }
    for (const id of ids) { if (/^dot-/.test(id)) continue; assert(html.includes('id="' + id + '"'), "missing id " + id); }
  });

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
