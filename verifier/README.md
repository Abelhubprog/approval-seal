# Receipt verifier

A static page, no backend and no build step. Two tabs:

1. **Hyperliquid receipts.** Enter a wallet address and a list of order ids (numeric oids or 0x client order ids). The page calls Hyperliquid's public info API from your browser (`orderStatus` for each id, and one `userFills` call for fill sizes and prices) and shows VERIFIED, FOUND NOT FILLED, NOT FOUND or ERROR per receipt, plus a summary such as `4 of 4 receipts verified, no login`. Only an order whose Hyperliquid status is `filled` counts as verified. If any receipt is not verified, the summary says so instead of showing N of N.
2. **Approval seal.** Paste an approval-seal record and verify it in the browser (SHA-256 via WebCrypto). Buttons load an example record, change the size (tamper demo), or change the size and recompute the hashes (forge demo, which passes unless you set the expected seal).

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
app.js              DOM wiring only
receipts.js         receipt logic (parse ids, call the API, classify, summarize), testable in Node
approval-seal.js    copy of ../approval-seal/js/approval-seal.js (a test checks they are identical)
example-data.json   EXAMPLE DATA, real public orders from a third-party wallet, not PROWZI receipts
test/               Node tests with saved real API responses as fixtures
```

## Tests

```bash
node test/verifier.test.js            # offline, mock fetch built from saved real responses
LIVE=1 node test/verifier.test.js     # also calls the real Hyperliquid API
```

## What a green result means

Hyperliquid's own public API reports a filled order with that id for that wallet. It does not show who approved the order, that it was a good trade, or that an agent behaved well. A `filled` order may be only partly filled: the details line shows the original size and the fills found. Not an audit, not financial advice.

## Privacy

Order ids and the wallet address are sent only to api.hyperliquid.xyz (or the testnet host if you pick testnet). Nothing is sent anywhere else and nothing is stored.
