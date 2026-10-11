/* approval-seal JS port (zero dependencies). Works in browsers (WebCrypto) and Node 18+.
 * Same rules as the Python library: see README.md. MIT licensed.
 *
 * Differences you must know about:
 *  - JSON.parse cannot tell 1.0 from 1, and loses precision above 2**53.
 *    Use parseStrict(text) on raw JSON text to reject those, as Python does.
 *  - All hashing functions are async because WebCrypto is async.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ApprovalSeal = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var VERSION = "approval-seal/1";
  var MAX_SAFE = 9007199254740991;
  var MAX_DEPTH = 64;
  var RECORD_KEYS = ["version", "action", "approver", "ts", "nonce", "expires_at", "action_hash", "seal"];
  var ESC = { '"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };

  function CanonicalError(msg) { this.name = "CanonicalError"; this.message = msg; }
  CanonicalError.prototype = Object.create(Error.prototype);

  function hex4(n) { return ("0000" + n.toString(16)).slice(-4); }

  function encStr(s) {
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i), ch = s.charAt(i);
      if (ESC[ch] !== undefined) out += ESC[ch];
      else if (c < 0x20) out += "\\u" + hex4(c);
      else if (c < 0x7f) out += ch;
      else if (c >= 0xd800 && c <= 0xdbff) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { out += "\\u" + hex4(c) + "\\u" + hex4(d); i++; }
        else throw new CanonicalError("lone surrogate in string");
      } else if (c >= 0xdc00 && c <= 0xdfff) throw new CanonicalError("lone surrogate in string");
      else out += "\\u" + hex4(c);
    }
    return out + '"';
  }

  // Compare strings by Unicode code point (JS default sort uses UTF-16 units).
  function cmpCodePoints(a, b) {
    var A = Array.from(a), B = Array.from(b), n = Math.min(A.length, B.length);
    for (var i = 0; i < n; i++) {
      var x = A[i].codePointAt(0), y = B[i].codePointAt(0);
      if (x !== y) return x < y ? -1 : 1;
    }
    return A.length - B.length;
  }

  function enc(v, depth) {
    if (depth > MAX_DEPTH) throw new CanonicalError("nesting deeper than " + MAX_DEPTH);
    if (v === null) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    var t = typeof v;
    if (t === "number") {
      if (!Number.isInteger(v)) throw new CanonicalError("floats are not allowed; use an integer or a decimal string");
      if (Math.abs(v) > MAX_SAFE) throw new CanonicalError("integer outside +/-(2**53 - 1); use a string");
      return Object.is(v, -0) ? "0" : String(v);
    }
    if (t === "string") return encStr(v);
    if (Array.isArray(v)) return "[" + v.map(function (x) { return enc(x, depth + 1); }).join(",") + "]";
    if (t === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      return "{" + Object.keys(v).sort(cmpCodePoints).map(function (k) {
        return encStr(k) + ":" + enc(v[k], depth + 1);
      }).join(",") + "}";
    }
    throw new CanonicalError("unsupported type: " + t);
  }

  function canonicalize(v) { return enc(v, 0); }

  // Reject number tokens that are not plain safe integers, then JSON.parse.
  function parseStrict(text) {
    var i = 0, n = text.length;
    while (i < n) {
      var ch = text.charAt(i);
      if (ch === '"') {
        i++;
        while (i < n && text.charAt(i) !== '"') i += text.charAt(i) === "\\" ? 2 : 1;
        i++;
      } else if (ch === "-" || (ch >= "0" && ch <= "9")) {
        var j = i;
        while (j < n && /[0-9eE+\-.]/.test(text.charAt(j))) j++;
        var tok = text.slice(i, j);
        if (!/^-?(0|[1-9][0-9]*)$/.test(tok)) {
          if (/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(tok))
            throw new CanonicalError("floats are not allowed: " + tok);
        } else if (Math.abs(Number(tok)) > MAX_SAFE) throw new CanonicalError("integer outside safe range: " + tok);
        i = j;
      } else i++;
    }
    return JSON.parse(text);
  }

  function toHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  function subtle() {
    var c = (typeof globalThis !== "undefined" && globalThis.crypto) || null;
    if (!c && typeof require === "function") c = require("node:crypto").webcrypto;
    if (!c || !c.subtle) throw new Error("WebCrypto (crypto.subtle) is not available; browsers need https or localhost");
    return c.subtle;
  }

  function sha256Hex(prefix, text) {
    return subtle().digest("SHA-256", new TextEncoder().encode(prefix + text)).then(toHex);
  }

  function actionHash(action) {
    return sha256Hex("approval-seal/1/action\n", canonicalize(action));
  }

  function sealValue(ahash, approver, ts, nonce, expiresAt) {
    return sha256Hex("approval-seal/1/seal\n", canonicalize({
      version: VERSION, action_hash: ahash, approver: approver, ts: ts, nonce: nonce, expires_at: expiresAt
    }));
  }

  function isInt(x) { return typeof x === "number" && Number.isInteger(x); }

  function fieldProblem(r) {
    if (typeof r.approver !== "string" || !r.approver) return "approver must be a non-empty string";
    if (!isInt(r.ts) || r.ts < 0) return "ts must be a non-negative integer (Unix seconds)";
    if (typeof r.nonce !== "string" || r.nonce.length < 8 || r.nonce.length > 128) return "nonce must be a string of 8 to 128 characters";
    if (!isInt(r.expires_at) || r.expires_at <= r.ts) return "expires_at must be an integer greater than ts";
    if (typeof r.action_hash !== "string" || typeof r.seal !== "string") return "hashes must be strings";
    return null;
  }

  function seal(action, approver, ts, nonce, ttlSeconds) {
    var ttl = ttlSeconds === undefined ? 900 : ttlSeconds;
    var rec = { approver: approver, ts: ts, nonce: nonce, expires_at: ts + ttl, action_hash: "", seal: "" };
    if (!isInt(ttl) || ttl <= 0) return Promise.reject(new Error("ttl_seconds must be a positive integer"));
    var p = fieldProblem(rec);
    if (p) return Promise.reject(new Error(p));
    return actionHash(action).then(function (ah) {
      return sealValue(ah, approver, ts, nonce, ts + ttl).then(function (sv) {
        return { version: VERSION, action: action, approver: approver, ts: ts, nonce: nonce,
                 expires_at: ts + ttl, action_hash: ah, seal: sv };
      });
    });
  }

  // Resolves to { ok, reason, detail, checks: [{name, ok, detail}] }
  function verify(record, opts) {
    opts = opts || {};
    var now = opts.now === undefined ? Math.floor(Date.now() / 1000) : opts.now;
    var skew = opts.skewSeconds === undefined ? 300 : opts.skewSeconds;
    var checks = [];
    function add(name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: ok ? "" : detail }); }
    function finish() {
      var f = checks.filter(function (c) { return !c.ok; })[0];
      return { ok: !f, reason: f ? f.name : null, detail: f ? f.detail : "", checks: checks };
    }
    var well = record !== null && typeof record === "object" && !Array.isArray(record) &&
      Object.keys(record).sort().join(",") === RECORD_KEYS.slice().sort().join(",");
    var problem = well ? fieldProblem(record) : "record must have exactly the keys: " + RECORD_KEYS.join(", ");
    add("well_formed", !problem, problem);
    if (problem) return Promise.resolve(finish());
    add("version", record.version === VERSION, "unsupported version " + JSON.stringify(record.version));
    var ahP;
    try { ahP = actionHash(record.action); }
    catch (e) { ahP = Promise.resolve(null); add("action_hash", false, "action is not canonicalizable: " + e.message); }
    return ahP.then(function (ah) {
      if (ah !== null) add("action_hash", ah === record.action_hash, "action does not match action_hash");
      return sealValue(record.action_hash, record.approver, record.ts, record.nonce, record.expires_at);
    }).then(function (sv) {
      add("seal", sv === record.seal, "seal does not match the record fields");
      if (opts.expectedSeal) add("expected_seal", opts.expectedSeal === record.seal, "record is not the one that was approved");
      add("not_expired", now <= record.expires_at, "approval expired at " + record.expires_at + " (now " + now + ")");
      add("not_from_future", record.ts <= now + skew, "approval timestamp is in the future");
      return finish();
    });
  }

  function hyperliquidCloid(recordOrHash) {
    var h = typeof recordOrHash === "string" ? recordOrHash : recordOrHash.action_hash;
    return "0x" + h.slice(0, 32);
  }

  function MemoryNonceStore() { this.seen = {}; }
  MemoryNonceStore.prototype.addIfAbsent = function (key, expiresAt, now) {
    for (var k in this.seen) if (this.seen[k] < now) delete this.seen[k];
    if (Object.prototype.hasOwnProperty.call(this.seen, key)) return false;
    this.seen[key] = expiresAt; return true;
  };

  function claim(record, store, opts) {
    opts = opts || {};
    var now = opts.now === undefined ? Math.floor(Date.now() / 1000) : opts.now;
    return verify(record, Object.assign({}, opts, { now: now })).then(function (res) {
      if (!res.ok) return res;
      var fresh = store.addIfAbsent(record.approver + "\n" + record.nonce, record.expires_at, now);
      res.checks.push({ name: "not_replayed", ok: fresh, detail: fresh ? "" : "this approval was already used (replay)" });
      if (!fresh) { res.ok = false; res.reason = "not_replayed"; res.detail = "this approval was already used (replay)"; }
      return res;
    });
  }

  return {
    VERSION: VERSION, CanonicalError: CanonicalError, canonicalize: canonicalize, parseStrict: parseStrict,
    actionHash: actionHash, seal: seal, verify: verify, claim: claim, MemoryNonceStore: MemoryNonceStore,
    hyperliquidCloid: hyperliquidCloid
  };
});
