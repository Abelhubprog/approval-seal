/* Step logic for the guided demo. No DOM here, so Node can test it. MIT licensed.
 * The page (demo.js) only draws what these functions return.
 *
 * Everything is EXAMPLE DATA. The sample order is never sent anywhere. The only network
 * calls are the read-only public Hyperliquid lookups in checkPublic(). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DemoSteps = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STEPS = [
    { id: "propose", title: "Agent proposes" },
    { id: "approve", title: "Owner approves" },
    { id: "verify",  title: "Anyone verifies" },
    { id: "tamper",  title: "Tamper" },
    { id: "forge",   title: "Forge attempt" },
    { id: "replay",  title: "Replay" },
    { id: "public",  title: "Check the public record" }
  ];

  var EXAMPLE_ACTION = {
    kind: "order", venue: "hyperliquid", network: "mainnet",
    account: "0x0000000000000000000000000000000000000001",
    coin: "ETH", side: "buy", size: "0.0100", limit_px: "2500.0", tif: "Ioc", reduce_only: false
  };

  // What the Tamper step can change. Each edit is applied to a copy of the approved record.
  var TAMPERS = {
    amount: { field: "size",  value: "10.0000",              label: "Change the amount" },
    venue:  { field: "venue", value: "other-exchange.example", label: "Change the venue" }
  };

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // List of changed leaf fields between two plain JSON values, as {path, from, to}.
  function diffFields(a, b, prefix) {
    var out = [], keys = {}, k;
    prefix = prefix || "";
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      for (k in a) keys[k] = true;
      for (k in b) keys[k] = true;
      Object.keys(keys).sort().forEach(function (key) {
        var p = prefix ? prefix + "." + key : key;
        if (!(key in a)) out.push({ path: p, from: undefined, to: b[key] });
        else if (!(key in b)) out.push({ path: p, from: a[key], to: undefined });
        else out = out.concat(diffFields(a[key], b[key], p));
      });
      return out;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: prefix, from: a, to: b });
    return out;
  }

  function failedNames(res) {
    return res.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.name; });
  }

  // deps: { AS: ApprovalSeal, R: Receipts, fetch, now(): unix seconds, nonce(): string,
  //         example: parsed example-data.json, ttl: seconds }
  function create(deps) {
    var AS = deps.AS, R = deps.R;
    var now = deps.now || function () { return Math.floor(Date.now() / 1000); };
    var ttl = deps.ttl || 900;
    var st;

    function fresh() { return { done: {}, action: null, record: null, storedSeal: null, store: null }; }
    st = fresh();

    // Every step method returns a promise (propose is synchronous and has no prerequisite).
    // A step run out of order gives a rejected promise, never a half-built result.
    function lacking(step, what) {
      return st.done[step] ? null : Promise.reject(new Error("Run \"" + what + "\" first"));
    }
    function tamperedCopy(kind) {
      var t = TAMPERS[kind];
      if (!t) throw new Error("Unknown tamper kind: " + kind);
      var rec = clone(st.record);
      rec.action[t.field] = t.value;
      return rec;
    }

    return {
      steps: STEPS,
      tampers: TAMPERS,
      isDone: function (id) { return !!st.done[id]; },
      reset: function () { st = fresh(); },

      // 1. Agent proposes. Pure data, nothing is signed or sent.
      propose: function () {
        st.action = clone(EXAMPLE_ACTION);
        st.done.propose = true;
        return { action: clone(st.action), json: JSON.stringify(st.action, null, 2) };
      },

      // 2. Owner approves: seal the exact action. The seal is stored separately, as a real approval service would.
      approve: function () {
        var bad = lacking("propose", "Agent proposes"); if (bad) return bad;
        var ts = now();
        return AS.seal(st.action, "owner@example.test", ts, deps.nonce(), ttl).then(function (rec) {
          st.record = rec;
          st.storedSeal = rec.seal;
          st.store = new AS.MemoryNonceStore();
          st.done.approve = true;
          return {
            record: clone(rec),
            actionHash: rec.action_hash,
            approval: { approver: rec.approver, ts: rec.ts, nonce: rec.nonce, expires_at: rec.expires_at },
            seal: rec.seal,
            cloid: AS.hyperliquidCloid(rec)
          };
        });
      },

      // 3. Anyone verifies the record against the stored seal. Does not consume the approval.
      verify: function () {
        var bad = lacking("approve", "Owner approves"); if (bad) return bad;
        return AS.verify(st.record, { now: now(), expectedSeal: st.storedSeal }).then(function (res) {
          st.done.verify = true;
          return res;
        });
      },

      // 4. Tamper: change one field after approval. Expect action_hash to fail, and name the field.
      tamper: function (kind) {
        var bad = lacking("approve", "Owner approves"); if (bad) return bad;
        var rec;
        try { rec = tamperedCopy(kind); } catch (e) { return Promise.reject(e); }
        var changes = diffFields(st.record.action, rec.action, "action");
        return AS.verify(rec, { now: now(), expectedSeal: st.storedSeal }).then(function (res) {
          st.done.tamper = true;
          return { kind: kind, record: rec, changes: changes, result: res, failed: failedNames(res) };
        });
      },

      // 5. Forge: change the amount AND recompute action_hash and seal so the record is self-consistent.
      //    Without the stored seal it looks fine. Against the stored seal it fails.
      forge: function () {
        var bad = lacking("approve", "Owner approves"); if (bad) return bad;
        var rec = tamperedCopy("amount");
        var changes = diffFields(st.record.action, rec.action, "action");
        return AS.actionHash(rec.action).then(function (ah) {
          rec.action_hash = ah;
          return AS.seal(rec.action, rec.approver, rec.ts, rec.nonce, rec.expires_at - rec.ts);
        }).then(function (re) {
          rec.seal = re.seal;
          return Promise.all([
            AS.verify(rec, { now: now() }),
            AS.verify(rec, { now: now(), expectedSeal: st.storedSeal })
          ]).then(function (r) {
            st.done.forge = true;
            return { record: rec, changes: changes, withoutStored: r[0], withStored: r[1],
                     failed: failedNames(r[1]), originalSeal: st.storedSeal, forgedSeal: rec.seal };
          });
        });
      },

      // 6. Replay: claim the same approval twice. The second claim is rejected.
      replay: function () {
        var bad = lacking("approve", "Owner approves"); if (bad) return bad;
        var store = new AS.MemoryNonceStore(), o = { now: now(), expectedSeal: st.storedSeal };
        return AS.claim(st.record, store, o).then(function (first) {
          return AS.claim(st.record, store, o).then(function (second) {
            st.done.replay = true;
            return { first: first, second: second, nonce: st.record.nonce };
          });
        });
      },

      // 7. Public record: derive the Hyperliquid client order id, then run the same receipts check
      //    the other tab runs against the EXAMPLE real public orders (third-party wallet).
      checkPublic: function () {
        var bad = lacking("approve", "Owner approves"); if (bad) return bad;
        var ex = deps.example;
        if (!ex || !ex.wallet || !Array.isArray(ex.receipts)) return Promise.reject(new Error("Example data is missing"));
        var cloid = AS.hyperliquidCloid(st.record);
        var ids = R.parseIds(ex.receipts.map(function (r) { return r.id; }).join("\n"));
        var opts = { fetch: deps.fetch, network: ex.network || "mainnet" };
        return R.checkAll(ex.wallet, ids, opts).then(function (out) {
          var summary = R.summarize(out.results);
          // The derived cloid belongs to the sample action, which was never sent. Not found is the right answer.
          return R.checkAll(ex.wallet, R.parseIds(cloid), opts).then(function (d) {
            st.done["public"] = true;
            return { cloid: cloid, wallet: ex.wallet, results: out.results, summary: summary, derived: d.results[0] };
          });
        });
      }
    };
  }

  return { STEPS: STEPS, EXAMPLE_ACTION: EXAMPLE_ACTION, TAMPERS: TAMPERS, diffFields: diffFields, failedNames: failedNames, create: create };
});
