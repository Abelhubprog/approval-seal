# Receipt verifier

A static page, no backend and no build step. Three tabs:

1. **Demo** (opens first). A 7-step guided walkthrough, one click per step, no typing: the agent proposes a sample order (EXAMPLE DATA), the owner approves and seals it, anyone verifies, tampering and a forgery attempt fail (the page names the changed field), a replay is rejected, and the public Hyperliquid record is checked (`4 of 4 receipts verified, no login`). Each step says what it proves and what it does not. Progress bar, Reset button, keyboard and screen reader friendly, works at 390 px wide. Step logic is in `demo-steps.js` (no DOM, tested in Node), drawing is in `demo.js`.
2. **Hyperliquid receipts.** Enter a wallet address and a list of order ids (numeric oids or 0x client order ids). The page calls Hyperliquid's public info API from your browser (`orderStatus` for each id, and one `userFills` call for fill sizes and prices) and shows VERIFIED, FOUND NOT FILLED, NOT FOUND or ERROR per receipt, plus a summary such as `4 of 4 receipts verified, no login`. Only an order whose Hyperliquid status is `filled` counts as verified. If any receipt is not verified, the summary says so instead of showing N of N.
3. **Approval seal.** Paste an approval-seal record and verify it in the browser (SHA-256 via WebCrypto). Buttons load an example record, change the size (tamper demo), or change the size and recompute the hashes (forge demo, which passes unless you set the expected seal).

## Run locally

```bash
cd verifier
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```

Serve it over http. Opening index.html with a file:// URL will not load example-data.json. WebCrypto needs https or localhost.

## Files

```
index.html          page and styles
app.js              DOM wiring for the tabs, receipts and seal panels
demo-steps.js       guided demo step logic (no DOM), testable in Node
demo.js             guided demo DOM wiring
receipts.js         receipt logic (parse ids, call the API, classify, summarize), testable in Node
approval-seal.js    copy of ../approval-seal/js/approval-seal.js (a test checks they are identical)
example-data.json   EXAMPLE DATA, real public orders from a third-party wallet, not PROWZI receipts
test/               Node tests with saved real API responses as fixtures
```

## Tests

```bash
node test/verifier.test.js            # offline, mock fetch built from saved real responses
node test/demo.test.js                # guided demo step logic, markup checks, docs/ copy check
LIVE=1 node test/verifier.test.js     # also calls the real Hyperliquid API
```

## What a green result means

Hyperliquid's own public API reports a filled order with that id for that wallet. It does not show who approved the order, that it was a good trade, or that an agent behaved well. A `filled` order may be only partly filled: the details line shows the original size and the fills found. Not an audit, not financial advice.

## Privacy

Order ids and the wallet address are sent only to api.hyperliquid.xyz (or the testnet host if you pick testnet). Nothing is sent anywhere else and nothing is stored.
