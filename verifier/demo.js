/* DOM wiring for the guided demo. All logic lives in demo-steps.js. MIT licensed. */
(function () {
  "use strict";
  var AS = window.ApprovalSeal, R = window.Receipts, DS = window.DemoSteps;
  var $ = function (id) { return document.getElementById(id); };
  var N = DS.STEPS.length;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function nonce() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function fmtTime(sec) { return new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC"; }
  function show(v) { return v === undefined ? "(missing)" : typeof v === "string" ? v : JSON.stringify(v); }

  var example = null;
  function loadExample() {
    if (example) return Promise.resolve(example);
    return fetch("example-data.json").then(function (r) { return r.json(); }).then(function (d) { example = d; return d; });
  }

  var demo, current, furthest;   // furthest = index of the first step that is not done yet
  function newDemo() {
    demo = DS.create({
      AS: AS, R: R, nonce: nonce,
      fetch: function (u, o) { return window.fetch(u, o); },
      get example() { return example; }
    });
    current = 0; furthest = 0;
  }

  // ---- drawing helpers
  function summary(kind, text) { var d = el("div", "summary " + kind, text); return d; }
  function kv(label, value, mono) {
    var d = el("div", "kv"); d.appendChild(el("div", "k", label)); d.appendChild(el("div", mono === false ? "" : "mono", value)); return d;
  }
  function checkList(res) {
    var ul = el("ul", "list");
    res.checks.forEach(function (c) {
      var li = el("li");
      li.appendChild(el("span", "badge " + (c.ok ? "ok" : "bad"), c.ok ? "PASS" : "FAIL"));
      li.appendChild(el("span", "mono", c.name));
      if (!c.ok) li.appendChild(el("div", "detail", c.detail));
      ul.appendChild(li);
    });
    return ul;
  }
  function changeLine(ch) {
    var d = el("div", "kv");
    d.appendChild(el("div", "k", "Field that changed"));
    var m = el("div", "mono changed", ch.path + ": " + show(ch.from) + " to " + show(ch.to));
    d.appendChild(m); return d;
  }
  function clear(n) { $("out-" + n).textContent = ""; return $("out-" + n); }
  function fail(n, e) { var o = clear(n); o.appendChild(summary("bad", "Something went wrong: " + (e && e.message ? e.message : e))); }

  // ---- progress
  function renderProgress() {
    $("demo-count").textContent = "Step " + (current + 1) + " of " + N + ": " + DS.STEPS[current].title;
    var done = DS.STEPS.filter(function (s) { return demo.isDone(s.id); }).length;
    var bar = $("demo-bar"); bar.setAttribute("aria-valuenow", String(done));
    bar.firstElementChild.style.width = Math.round(done / N * 100) + "%";
    DS.STEPS.forEach(function (s, i) {
      var b = $("dot-" + i), isDone = demo.isDone(s.id);
      b.className = isDone ? "done" : "";
      b.disabled = i > furthest;
      if (i === current) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
      b.setAttribute("aria-label", "Step " + (i + 1) + ": " + s.title + (isDone ? ", done" : i > furthest ? ", locked until the earlier steps are done" : ""));
    });
    for (var i = 0; i < N; i++) {
      $("step-" + (i + 1)).hidden = i !== current;
      $("step-" + (i + 1)).querySelector("[data-next]").disabled = !demo.isDone(DS.STEPS[i].id);
    }
    $("demo-finish").hidden = !demo.isDone("public");
  }
  function go(i, focus) {
    current = Math.max(0, Math.min(N - 1, i));
    renderProgress();
    if (focus) $("step-" + (current + 1) + "-h").focus();
  }
  function completed(i) {
    furthest = Math.max(furthest, Math.min(N - 1, i + 1));
    renderProgress();
    var nx = $("step-" + (i + 1)).querySelector("[data-next]");
    if (!nx.disabled) nx.focus();
  }

  // ---- steps
  function run(i, btn, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    Promise.resolve().then(fn).then(function () { completed(i); }, function (e) { fail(i + 1, e); btn.disabled = false; });
  }

  $("do-1").onclick = function () {
    var b = this;
    run(0, b, function () {
      var r = demo.propose(), o = clear(1);
      o.appendChild(el("div", "k", "Proposed order (EXAMPLE DATA)"));
      o.appendChild(el("pre", "json", r.json));
    });
  };

  $("do-2").onclick = function () {
    var b = this;
    run(1, b, function () {
      return demo.approve().then(function (r) {
        var o = clear(2);
        o.appendChild(summary("ok", "SEALED. This exact order is now bound to the approval."));
        o.appendChild(kv("action_hash (SHA-256 of the order)", r.actionHash));
        o.appendChild(kv("Approval: approver, time, nonce, expiry",
          r.approval.approver + " | " + fmtTime(r.approval.ts) + " | nonce " + r.approval.nonce + " | expires " + fmtTime(r.approval.expires_at)));
        o.appendChild(kv("seal (hash of action_hash plus the approval)", r.seal));
        o.appendChild(el("p", "hint", "The seal is saved separately as the stored seal. Steps 3 to 6 check against it."));
      });
    });
  };

  $("do-3").onclick = function () {
    var b = this;
    run(2, b, function () {
      return demo.verify().then(function (res) {
        var o = clear(3);
        o.appendChild(summary(res.ok ? "ok" : "bad", res.ok ? "VERIFIED: unchanged since sealing, matches the stored seal, not expired" : "REJECTED: " + res.reason));
        o.appendChild(checkList(res));
      });
    });
  };

  function doTamper(kind) {
    var b4 = [$("do-4a"), $("do-4b")];
    b4.forEach(function (b) { b.disabled = true; });
    demo.tamper(kind).then(function (r) {
      var o = clear(4);
      o.appendChild(summary(r.result.ok ? "ok" : "bad", r.result.ok ? "Unexpectedly accepted" : "REJECTED: " + r.result.reason));
      r.changes.forEach(function (ch) { o.appendChild(changeLine(ch)); });
      o.appendChild(checkList(r.result));
      o.appendChild(el("p", "hint", "The seal itself still matches, because the seal covers the original action_hash. The edited order no longer hashes to it, so action_hash fails."));
      b4.forEach(function (b) { b.disabled = false; });
      completed(3);
    }, function (e) { fail(4, e); b4.forEach(function (b) { b.disabled = false; }); });
  }
  $("do-4a").onclick = function () { doTamper("amount"); };
  $("do-4b").onclick = function () { doTamper("venue"); };

  $("do-5").onclick = function () {
    var b = this;
    run(4, b, function () {
      return demo.forge().then(function (r) {
        var o = clear(5);
        r.changes.forEach(function (ch) { o.appendChild(changeLine(ch)); });
        o.appendChild(el("div", "k", "Check 1: the forged record on its own (no stored seal)"));
        o.appendChild(summary(r.withoutStored.ok ? "warn" : "bad", r.withoutStored.ok
          ? "PASS, but only self-consistent. Anyone can recompute hashes, so this proves nothing about approval."
          : "REJECTED: " + r.withoutStored.reason));
        o.appendChild(el("div", "k", "Check 2: the forged record against the stored seal"));
        o.appendChild(summary(r.withStored.ok ? "ok" : "bad", r.withStored.ok ? "Unexpectedly accepted" : "REJECTED: " + r.failed.join(", ")));
        o.appendChild(checkList(r.withStored));
        o.appendChild(kv("Stored seal (from step 2)", r.originalSeal));
        o.appendChild(kv("Forged seal (recomputed by the attacker)", r.forgedSeal));
      });
    });
  };

  $("do-6").onclick = function () {
    var b = this;
    run(5, b, function () {
      return demo.replay().then(function (r) {
        var o = clear(6);
        o.appendChild(el("div", "k", "Claim 1 of 2 (nonce " + r.nonce + ")"));
        o.appendChild(summary(r.first.ok ? "ok" : "bad", r.first.ok ? "ACCEPTED: the executor may run the order once" : "REJECTED: " + r.first.reason));
        o.appendChild(el("div", "k", "Claim 2 of 2 (same approval again)"));
        o.appendChild(summary(r.second.ok ? "ok" : "bad", r.second.ok ? "Unexpectedly accepted" : "REJECTED: " + r.second.reason + ". This approval was already used."));
        o.appendChild(checkList(r.second));
      });
    });
  };

  function receiptRow(r) {
    var li = el("li");
    li.appendChild(el("span", "badge " + (r.state === "verified" ? "ok" : r.state === "not_filled" ? "warn" : "bad"),
      r.state === "verified" ? "VERIFIED" : r.state === "not_filled" ? "FOUND, NOT FILLED" : r.state === "not_found" ? "NOT FOUND" : "ERROR"));
    li.appendChild(el("span", "mono", r.id.raw));
    if (r.order) {
      var o = r.order;
      li.appendChild(el("div", "detail", o.side + " " + o.origSz + " " + o.coin + " limit " + o.limitPx + ", status " + o.hlStatus));
    } else li.appendChild(el("div", "detail", r.detail));
    return li;
  }

  $("do-7").onclick = function () {
    var b = this;
    run(6, b, function () {
      var o = clear(7);
      o.appendChild(summary("", "Asking Hyperliquid's public API..."));
      return loadExample().then(function () { return demo.checkPublic(); }).then(function (r) {
        o = clear(7);
        o.appendChild(kv("Client order id derived from the sealed action from step 2 (0x plus the first 32 hex of action_hash)", r.cloid));
        o.appendChild(el("div", "k", "Receipts check: real public orders (EXAMPLE DATA, third-party wallet)"));
        o.appendChild(summary(r.summary.allVerified ? "ok" : "bad", r.summary.text));
        var ul = el("ul", "list"); r.results.forEach(function (x) { ul.appendChild(receiptRow(x)); }); o.appendChild(ul);
        o.appendChild(el("div", "k", "Lookup of the derived id for the same wallet"));
        var ul2 = el("ul", "list"); ul2.appendChild(receiptRow(r.derived)); o.appendChild(ul2);
        o.appendChild(el("p", "hint", "Not found is the right answer here: the sample order from step 1 was never sent to Hyperliquid. If an executor had set this id on a real order, the public record would carry it and this lookup would find it."));
      }).catch(function (e) {
        throw new Error("Could not reach Hyperliquid's public API from this browser (" + (e && e.message ? e.message : e) + "). Check your connection and click again.");
      });
    });
  };

  // ---- navigation
  Array.prototype.forEach.call(document.querySelectorAll("[data-next]"), function (b) {
    b.onclick = function () {
      var n = Number(b.getAttribute("data-next"));
      if (n >= N) { $("demo-finish").hidden = false; $("demo-finish").focus(); return; }   // last step: Finish jumps to the wrap-up
      go(n, true);
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-back]"), function (b) {
    b.onclick = function () { go(Number(b.getAttribute("data-back")) - 2, true); };
  });

  var dots = $("demo-dots");
  DS.STEPS.forEach(function (s, i) {
    var li = el("li"), b = el("button", "", String(i + 1));
    b.type = "button"; b.id = "dot-" + i;
    b.onclick = function () { go(i, true); };
    li.appendChild(b); dots.appendChild(li);
  });

  function resetAll() {
    newDemo();
    for (var i = 1; i <= N; i++) clear(i);
    ["do-1", "do-2", "do-3", "do-4a", "do-4b", "do-5", "do-6", "do-7"].forEach(function (id) { $(id).disabled = false; });
    renderProgress();
    $("step-1-h").focus();
  }
  $("demo-reset").onclick = resetAll;
  $("demo-again").onclick = resetAll;
  $("demo-own").onclick = function () { $("tab-receipts").click(); $("tab-receipts").focus(); };

  newDemo();
  renderProgress();
})();
