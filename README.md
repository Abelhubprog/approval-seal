# approval-seal

Tamper-evident, expiring, single-use approvals for AI agent actions. Zero dependencies. MIT license.

An agent proposes an action (for example, a trade). A human approves it. `approval-seal` binds the exact action to that approval with a SHA-256 seal, so the executor can refuse to run anything that changed after approval, anything that expired, and anything already used.

Status: version 0.1.0, written for a hackathon. Python reference implementation plus a JavaScript port that passes the same test vectors. It has not had an external security review.

## 60-second quickstart

Python 3.8 or newer, nothing to install:

```bash
git clone https://github.com/Abelhubprog/approval-seal && cd approval-seal
python3 -m unittest discover -s tests      # 26 tests
node js/test.js                            # 53 checks, same vectors (optional, Node 18+)
python3 examples/hyperliquid_order.py      # seal, claim, replay, tamper, all offline
```

Use it in code:

```python
from approval_seal import seal, verify, claim, MemoryNonceStore, new_nonce
import time

action = {"kind": "order", "venue": "hyperliquid", "coin": "ETH", "side": "buy",
          "size": "0.0100", "limit_px": "2500.0"}          # decimals are strings, never floats

# 1. When the human approves: seal, and STORE record["seal"] in your own database.
record = seal(action, approver="owner@example.test", ts=int(time.time()), nonce=new_nonce(), ttl_seconds=300)
stored_seal = record["seal"]

# 2. Right before executing: verify against the stored seal and consume it once.
result = claim(record, MemoryNonceStore(), expected_seal=stored_seal)
if not result.ok:
    raise SystemExit("refusing to execute: " + result.reason)   # e.g. action_hash, expected_seal, not_expired, not_replayed
# ... send the order ...
```

Command line (exit code 0 if verified, 1 if rejected):

```bash
python3 -m approval_seal seal examples/order.json --approver owner@example.test > record.json
python3 -m approval_seal verify record.json
sed 's/"size": "0.0100"/"size": "10.0000"/' record.json > bad.json
python3 -m approval_seal verify bad.json     # REJECTED: action_hash
```

Real output of the last command:

```
well_formed      ok
version          ok
action_hash      FAIL  action does not match action_hash
seal             ok
not_expired      ok
not_from_future  ok
REJECTED: action_hash
```

A browser verifier with a tamper button lives in the sibling `verifier/` folder (single HTML page, no backend).

## Specification (approval-seal/1)

### Canonical JSON (canonical-json/1)

The seal hashes canonical JSON so that every language produces the same bytes.

- Allowed values: `null`, `true`, `false`, integers, strings, arrays, objects with string keys.
- Integers must satisfy |n| <= 2^53 - 1 (so JavaScript can hold them). Larger values must be strings.
- Floats, NaN, Infinity, bytes, sets, non-string keys, lone surrogates, and nesting deeper than 64 levels are rejected. Put money amounts and prices in strings such as `"0.0100"`.
- Output has no whitespace. Object keys are sorted by Unicode code point.
- Strings: printable ASCII (space to `~`) is written literally, except `"` and `\`, which are escaped. `\b \f \n \r \t` use their short forms. Every other character, including DEL (0x7f), control characters and all non-ASCII, is written as `\uXXXX` with four lowercase hex digits. Characters above U+FFFF become a surrogate pair. The output is therefore pure ASCII.
- No Unicode normalization is applied. `"é"` written as one code point and as two code points are different strings and hash differently.
- For values in this subset the output equals Python's `json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=True)`. The tests check this against the standard library.

### Seal

```
action_hash = hex(SHA-256( "approval-seal/1/action\n" + canonical(action) ))
seal        = hex(SHA-256( "approval-seal/1/seal\n" + canonical({
                 "version": "approval-seal/1", "action_hash": action_hash,
                 "approver": approver, "ts": ts, "nonce": nonce, "expires_at": expires_at })))
```

`ts` and `expires_at` are Unix seconds (integers). `expires_at = ts + ttl_seconds`, default ttl 900. `nonce` is a string of 8 to 128 characters, 32 random hex characters from `new_nonce()` is recommended. `approver` is a non-empty string.

### Record

```json
{
  "version": "approval-seal/1",
  "action": { "...": "any value in the canonical subset" },
  "approver": "owner@example.test",
  "ts": 1790000000,
  "nonce": "0123456789abcdef0123456789abcdef",
  "expires_at": 1790000900,
  "action_hash": "93fb66a9...",
  "seal": "09962d38..."
}
```

A record has exactly these eight keys. Extra or missing keys fail `well_formed`.

### verify(record, now=None, expected_seal=None, skew_seconds=300)

Computes every check and reports the first failure. Checks, in order:

| check | fails when |
|---|---|
| `well_formed` | wrong keys, wrong field types, nonce length, `expires_at <= ts` |
| `version` | `version` is not `approval-seal/1` |
| `action_hash` | the action in the record does not hash to `action_hash` (the action was changed) |
| `seal` | the seal does not match the fields (approver, ts, nonce, expiry or action_hash was changed) |
| `expected_seal` | only if you pass one: the record's seal is not the one you stored at approval time |
| `not_expired` | `now > expires_at` (equal is still valid) |
| `not_from_future` | `ts > now + skew_seconds` |

### claim(record, store, ...)

Runs `verify`, then consumes `(approver, nonce)` in a store with an atomic `add_if_absent(key, expires_at, now)`. A second claim fails with `not_replayed`. A failed verification does not consume the nonce. `MemoryNonceStore` is in-process only: for real use, back it with a database unique constraint that every executor shares.

### Test vectors

`vectors/test_vectors.json` holds canonicalization cases (valid and invalid), one published seal, and 19 verify cases including the tamper cases. The Python and JavaScript suites both run it. `tools/gen_vectors.py` regenerates it; treat a diff as a wire-format change.

## Threat model

What a passing check proves:

- The action, approver, timestamp, nonce and expiry in the record are exactly the ones that were sealed, if you verified against a seal you stored yourself (`expected_seal`).
- The approval has not expired by your clock, and (with `claim` and a shared store) it has not been used before.
- Anyone can recompute the hashes and see that they match, in Python, JavaScript or the browser page.

What it does not prove:

- **Who approved.** `approver` is a string the sealer chose. There is no signature and no key in version 0.1.0. Anyone can create a record that claims any approver.
- **Integrity without a stored seal.** Without `expected_seal`, `verify` only shows the record is self-consistent. An attacker who can edit the record can recompute both hashes (the test suite shows this forgery passing). Store the seal where the attacker cannot write, or publish it.
- **That the executed order matches the action.** The library checks the approved record. Your executor must send exactly `record["action"]` and nothing else. If it builds the order from other data, the seal does not help.
- **That the trade happened or was good.** For that, check the venue's own public record (see the Hyperliquid example below). This is not an audit, not a guarantee of profit, and not financial advice.
- **Protection against a compromised executor or approval service.** If they are compromised, they can seal or claim anything.
- **Clock honesty.** Expiry uses the clock of whoever runs `verify`.
- **Confidentiality.** The action is in the record in the clear.

Known limits of the JavaScript port: `JSON.parse` cannot tell `1.0` from `1`, and loses precision above 2^53. Use `parseStrict(text)` on raw JSON text, which rejects both as Python does. Duplicate keys in JSON text are accepted by both languages with the last value winning; reject them upstream if that matters to you.

Ideas not built: a signature (for example Ed25519 or an EIP-712 signed approval) so `approver` is authenticated; a counter-signature from the executor; transparency-log publication of seals.

## Example: map an approved Hyperliquid order to a public check

Hyperliquid's public info endpoint answers `orderStatus` for any wallet with no login. Per Hyperliquid's API docs, `oid` can be the numeric order id or a 16-byte hex client order id (`cloid`, written as `0x` plus 32 hex characters).

`approval-seal` gives you a ready cloid: `hyperliquid_cloid(record)` returns `"0x" + action_hash[:32]`. If your executor sets that cloid when it places the order, the public order record carries a pointer back to the sealed action, and anyone can recompute it from the record.

```bash
# by numeric order id (from your order response)
curl -s -X POST https://api.hyperliquid.xyz/info -H 'content-type: application/json' \
  -d '{"type":"orderStatus","user":"0xYOUR_ACCOUNT_ADDRESS","oid":571115389356}'

# or by the cloid derived from the sealed action
curl -s -X POST https://api.hyperliquid.xyz/info -H 'content-type: application/json' \
  -d '{"type":"orderStatus","user":"0xYOUR_ACCOUNT_ADDRESS","oid":"0x93fb66a910eb89ae1aa761b85c98acba"}'
```

Response shape (captured 2026-10-11 from a public third-party order, trimmed):

```json
{"status":"order","order":{"order":{"coin":"ETH","side":"B","limitPx":"2751.9","sz":"0.1938",
 "oid":571115389356,"orderType":"Limit","origSz":"0.2404","tif":"Ioc","cloid":"0x5048110c000013cd8f8d7bca8eef747b"},
 "status":"filled","statusTimestamp":1791718882393}}
```

An id Hyperliquid does not know for that wallet returns `{"status":"unknownOid"}`. `examples/hyperliquid_order.py` has `compare_order(action, status)`, which compares coin, side, size, limit price and status between the sealed action and this response.

Notes you should know:

- `status: "filled"` does not mean the full size filled. In the capture above, `origSz` is 0.2404 and `sz` (remaining) is 0.1938. Use `userFills` for fill sizes and prices.
- `userFills` returns only the most recent 2000 fills.
- Use the account address that owns the order, not an agent or API wallet address.
- We have not placed an order with a derived cloid on mainnet from this library. The cloid format is from Hyperliquid's documentation and real orders in the public feed carry cloids of that shape. Test on testnet before relying on it.

## Repository layout

```
approval_seal/      Python package (canonical.py, seal.py, __main__.py)
js/                 JavaScript port (approval-seal.js) and test.js
vectors/            test_vectors.json shared by both test suites
tests/              Python unit tests (canonicalization, vectors, tamper rejection)
examples/           hyperliquid_order.py, order.json
tools/              gen_vectors.py
SECURITY.md  LICENSE
```

## License

MIT, see LICENSE. No warranty.
