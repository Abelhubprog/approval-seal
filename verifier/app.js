(function () {
  "use strict";
  var AS = window.ApprovalSeal, R = window.Receipts;
  var $ = function (id) { return document.getElementById(id); };

  // ---- tabs
  function showTab(name) {
    ["receipts", "seal"].forEach(function (n) {
      $("panel-" + n).hidden = n !== name;
      $("tab-" + n).setAttribute("aria-selected", String(n === name));
    });
  }
  $("tab-receipts").onclick = function () { showTab("receipts"); };
  $("tab-seal").onclick = function () { showTab("seal"); };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function fmtTime(ms) { return ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC" : ""; }

  // ---- receipts tab
  function loadExample(withFake) {
    fetch("example-data.json").then(function (r) { return r.json(); }).then(function (d) {
      $("wallet").value = d.wallet;
      $("network").value = d.network;
      var lines = d.receipts.map(function (x) { return x.id + "   # " + x.note; });
      if (withFake) lines.push(d.fake_id_for_demo.id + "   # " + d.fake_id_for_demo.note);
      $("ids").value = lines.join("\n");
      $("example-banner").hidden = false;
    }).catch(function () {
      var s = $("summary"); s.hidden = false; s.className = "summary bad";
      s.textContent = "Could not load example-data.json. If you opened this file directly, serve the folder over http instead (see README).";
    });
  }
  $("load-example").onclick = function () { loadExample(false); };
  $("load-example-fake").onclick = function () { loadExample(true); };
  $("wallet").oninput = function () { $("example-banner").hidden = true; };

  // Optional receipts.json next to this page (added after the recorded trade). Same shape as example-data.json
  // but without the example flag. If the file is absent the button simply stays hidden.
  fetch("receipts.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || d.example === true || !d.wallet || !Array.isArray(d.receipts) || !d.receipts.length) return;
    var b = $("load-real"); b.hidden = false;
    b.onclick = function () {
      $("wallet").value = d.wallet; $("network").value = d.network || "mainnet";
      $("ids").value = d.receipts.map(function (x) { return x.id + (x.note ? "   # " + x.note : ""); }).join("\n");
      $("example-banner").hidden = true;
    };
  }).catch(function () {});

  function renderResult(r) {
    var li = el("li");
    var badge = el("span", "badge " + (r.state === "verified" ? "ok" : r.state === "not_filled" ? "warn" : "bad"),
      r.state === "verified" ? "VERIFIED" : r.state === "not_filled" ? "FOUND, NOT FILLED" : r.state === "not_found" ? "NOT FOUND" : "ERROR");
    li.appendChild(badge);
    li.appendChild(el("span", "mono", r.id.raw));
    if (r.order) {
      var o = r.order;
      li.appendChild(el("div", "detail", o.side + " " + o.origSz + " " + o.coin + " limit " + o.limitPx + " (" + o.orderType + ", " + o.tif + "), placed " + fmtTime(o.placedAt) + ", status " + o.hlStatus));
      if (o.cloid) li.appendChild(el("div", "detail", "cloid " + o.cloid));
      if (r.fills) li.appendChild(el("div", "detail", "fills: " + r.fills.count + ", total size " + r.fills.size + (r.fills.avgPx ? ", average price " + r.fills.avgPx.toPrecision(7) : "") + ", fill tx " + r.fills.hash));
      else if (r.state === "verified") li.appendChild(el("div", "detail", "fill details not shown (userFills returns only the most recent 2000 fills)"));
    } else li.appendChild(el("div", "detail", r.detail));
    return li;
  }

  $("check").onclick = function () {
    var wallet = $("wallet").value.trim(), ids = R.parseIds($("ids").value);
    var s = $("summary"), list = $("results"); list.textContent = "";
    s.hidden = false;
    if (!R.isWallet(wallet)) { s.className = "summary bad"; s.textContent = "Enter a wallet address: 0x plus 40 hex characters."; return; }
    if (!ids.length) { s.className = "summary bad"; s.textContent = "Add at least one order id."; return; }
    s.className = "summary"; s.textContent = "Checking Hyperliquid...";
    $("check").disabled = true;
    R.checkAll(wallet, ids, { network: $("network").value, onProgress: function (r, d, t) { s.textContent = "Checking Hyperliquid... " + d + " of " + t; } })
      .then(function (out) {
        out.results.forEach(function (r) { list.appendChild(renderResult(r)); });
        var sum = R.summarize(out.results);
        s.textContent = sum.text;
        s.className = "summary " + (sum.allVerified ? "ok" : "bad");
      })
      .catch(function (e) { s.className = "summary bad"; s.textContent = "Could not check: " + e.message; })
      .then(function () { $("check").disabled = false; });
  };

  // ---- seal tab
  var EXAMPLE_ACTION = {
    kind: "order", venue: "hyperliquid", network: "mainnet",
    account: "0x0000000000000000000000000000000000000001",
    coin: "ETH", side: "buy", size: "0.0100", limit_px: "2500.0", tif: "Ioc", reduce_only: false
  };
  function nonce() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function parseRecord() { return AS.parseStrict($("record").value); }
  function setRecord(rec) { $("record").value = JSON.stringify(rec, null, 2); }

  function showSealResult(res, rec) {
    var s = $("seal-summary"), list = $("seal-checks"); list.textContent = ""; s.hidden = false;
    res.checks.forEach(function (c) {
      var li = el("li");
      li.appendChild(el("span", "badge " + (c.ok ? "ok" : "bad"), c.ok ? "PASS" : "FAIL"));
      li.appendChild(el("span", "mono", c.name));
      if (!c.ok) li.appendChild(el("div", "detail", c.detail));
      list.appendChild(li);
    });
    s.className = "summary " + (res.ok ? "ok" : "bad");
    s.textContent = res.ok ? "VERIFIED: hashes match and the approval has not expired" + ($("expected").value.trim() ? ", and it is the approved record" : " (self-consistency only)")
                           : "REJECTED: " + res.reason + (res.detail ? ". " + res.detail : "");
    var cb = $("cloid-box");
    if (rec && typeof rec.action_hash === "string") { $("cloid").textContent = AS.hyperliquidCloid(rec); cb.hidden = false; } else cb.hidden = true;
  }

  function runVerify() {
    var rec;
    try { rec = parseRecord(); }
    catch (e) { showSealResult({ ok: false, reason: "unreadable", detail: e.message, checks: [{ name: "parse", ok: false, detail: e.message }] }, null); return Promise.resolve(); }
    return AS.verify(rec, { expectedSeal: $("expected").value.trim() || undefined }).then(function (res) { showSealResult(res, rec); })
      .catch(function (e) { showSealResult({ ok: false, reason: "error", detail: e.message, checks: [{ name: "verify", ok: false, detail: e.message }] }, null); });
  }
  $("verify").onclick = runVerify;

  $("load-record").onclick = function () {
    var ts = Math.floor(Date.now() / 1000);
    AS.seal(EXAMPLE_ACTION, "owner@example.test", ts, nonce(), 900).then(function (rec) {
      setRecord(rec); $("expected").value = rec.seal; $("record-banner").hidden = false; return runVerify();
    });
  };

  $("tamper").onclick = function () {
    var rec; try { rec = parseRecord(); } catch (e) { return runVerify(); }
    if (!rec.action || typeof rec.action !== "object") return runVerify();
    rec.action.size = "10.0000";
    setRecord(rec); runVerify();
  };

  $("forge").onclick = function () {
    var rec; try { rec = parseRecord(); } catch (e) { return runVerify(); }
    if (!rec.action || typeof rec.action !== "object") return runVerify();
    rec.action.size = "10.0000";
    AS.actionHash(rec.action).then(function (ah) {
      rec.action_hash = ah;
      return AS.seal(rec.action, rec.approver, rec.ts, rec.nonce, rec.expires_at - rec.ts);
    }).then(function (re) { rec.seal = re.seal; setRecord(rec); return runVerify(); })
      .then(function () {
        if (!$("expected").value.trim()) { var s = $("seal-summary"); s.textContent += " Note: no expected seal is set, so the forgery passes. Paste the original seal into Expected seal and verify again."; }
      });
  };

  $("use-cloid").onclick = function () {
    var c = $("cloid").textContent; showTab("receipts");
    $("ids").value = c + "   # derived from the approval-seal record; only matches if the executor set this cloid on the order";
  };
})();
