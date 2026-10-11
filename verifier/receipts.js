/* Receipt checking logic for the verifier page. No DOM here, so Node can test it.
 * Calls Hyperliquid's public info API (POST /info): orderStatus and userFills. MIT licensed. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Receipts = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MAINNET = "https://api.hyperliquid.xyz/info";
  var TESTNET = "https://api.hyperliquid-testnet.xyz/info";
  var MAX_IDS = 50;

  function isWallet(s) { return /^0x[0-9a-fA-F]{40}$/.test(String(s || "").trim()); }

  // One id per line or separated by commas/spaces. "#" starts a comment. 16-byte hex = cloid, digits = oid.
  function parseIds(text) {
    var out = [], seen = {};
    String(text || "").split(/\r?\n/).forEach(function (line) {
      line.replace(/#.*$/, "").split(/[\s,;]+/).forEach(function (tok) {
        if (!tok) return;
        if (seen[tok.toLowerCase()]) return;
        seen[tok.toLowerCase()] = true;
        if (/^[0-9]{1,19}$/.test(tok)) out.push({ raw: tok, kind: "oid", value: Number(tok) <= Number.MAX_SAFE_INTEGER ? Number(tok) : null });
        else if (/^0x[0-9a-fA-F]{32}$/.test(tok)) out.push({ raw: tok, kind: "cloid", value: tok.toLowerCase() });
        else out.push({ raw: tok, kind: "invalid", value: null });
      });
    });
    return out;
  }

  // Turn one orderStatus response into a verdict. Only a "filled" order counts as verified.
  function classify(resp) {
    if (!resp || typeof resp !== "object") return { state: "error", detail: "Unexpected response from Hyperliquid" };
    if (resp.status === "unknownOid") return { state: "not_found", detail: "Hyperliquid has no such order for this wallet" };
    if (resp.status === "order" && resp.order && resp.order.order) {
      var o = resp.order.order, st = resp.order.status;
      var info = {
        coin: o.coin, side: o.side === "B" ? "buy" : o.side === "A" ? "sell" : o.side,
        limitPx: o.limitPx, origSz: o.origSz, remainingSz: o.sz, oid: o.oid, cloid: o.cloid || null,
        orderType: o.orderType, tif: o.tif, placedAt: o.timestamp, statusAt: resp.order.statusTimestamp, hlStatus: st
      };
      if (st === "filled") return { state: "verified", detail: "Order found and filled", order: info };
      return { state: "not_filled", detail: "Order found, status is \"" + st + "\" (not counted as verified)", order: info };
    }
    return { state: "error", detail: "Unexpected response shape" };
  }

  // Sum the fills that belong to an order, from a userFills array. Shows fill size and average price.
  function summarizeFills(fills, order) {
    if (!Array.isArray(fills) || !order) return null;
    var mine = fills.filter(function (f) {
      return f.oid === order.oid || (order.cloid && f.cloid && f.cloid.toLowerCase() === order.cloid.toLowerCase());
    });
    if (!mine.length) return null;
    var sz = 0, notional = 0, fee = 0;
    mine.forEach(function (f) { var s = Number(f.sz), p = Number(f.px); sz += s; notional += s * p; fee += Number(f.fee || 0); });
    return { count: mine.length, size: sz, avgPx: sz ? notional / sz : null, fee: fee, firstTime: Math.min.apply(null, mine.map(function (f) { return f.time; })), hash: mine[0].hash };
  }

  function post(fetchImpl, url, body) {
    return fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.text().then(function (t) {
          if (!r.ok) throw new Error("HTTP " + r.status + (t ? ": " + t.slice(0, 120) : ""));
          try { return JSON.parse(t); } catch (e) { throw new Error("Response was not JSON"); }
        });
      });
  }

  function checkOne(fetchImpl, url, wallet, id, fills) {
    if (id.kind === "invalid" || id.value === null)
      return Promise.resolve({ id: id, state: "error", detail: "Not a valid order id (use digits for an oid or 0x plus 32 hex for a cloid)" });
    return post(fetchImpl, url, { type: "orderStatus", user: wallet, oid: id.value }).then(function (resp) {
      var v = classify(resp);
      v.id = id;
      if (v.order && fills) v.fills = summarizeFills(fills, v.order);
      return v;
    }, function (err) { return { id: id, state: "error", detail: "Request failed: " + err.message }; });
  }

  // opts: { fetch, network: "mainnet"|"testnet", onProgress(result, done, total) }
  function checkAll(wallet, ids, opts) {
    opts = opts || {};
    var fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    if (!fetchImpl) return Promise.reject(new Error("fetch is not available"));
    var url = opts.network === "testnet" ? TESTNET : MAINNET;
    if (!isWallet(wallet)) return Promise.reject(new Error("Wallet must be 0x plus 40 hex characters"));
    if (ids.length > MAX_IDS) return Promise.reject(new Error("At most " + MAX_IDS + " ids at a time"));
    wallet = wallet.trim().toLowerCase();
    return post(fetchImpl, url, { type: "userFills", user: wallet }).catch(function () { return null; }).then(function (fills) {
      var results = new Array(ids.length), next = 0, done = 0;
      function worker() {
        if (next >= ids.length) return Promise.resolve();
        var i = next++;
        return checkOne(fetchImpl, url, wallet, ids[i], fills).then(function (r) {
          results[i] = r; done++;
          if (opts.onProgress) opts.onProgress(r, done, ids.length);
          return worker();
        });
      }
      var workers = []; for (var k = 0; k < Math.min(4, ids.length); k++) workers.push(worker());
      return Promise.all(workers).then(function () { return { results: results, fillsLoaded: Array.isArray(fills) }; });
    });
  }

  function summarize(results) {
    var c = { verified: 0, not_filled: 0, not_found: 0, error: 0 };
    results.forEach(function (r) { c[r.state]++; });
    var total = results.length, text;
    if (total === 0) text = "No receipts to check";
    else if (c.verified === total) text = total + " of " + total + " receipts verified, no login";
    else {
      var rest = [];
      if (c.not_found) rest.push(c.not_found + " not found");
      if (c.not_filled) rest.push(c.not_filled + " found but not filled");
      if (c.error) rest.push(c.error + " could not be checked");
      text = c.verified + " of " + total + " receipts verified (" + rest.join(", ") + ")";
    }
    return { verified: c.verified, total: total, counts: c, allVerified: total > 0 && c.verified === total, text: text };
  }

  return { MAINNET: MAINNET, TESTNET: TESTNET, MAX_IDS: MAX_IDS, isWallet: isWallet, parseIds: parseIds,
           classify: classify, summarizeFills: summarizeFills, checkAll: checkAll, summarize: summarize };
});
