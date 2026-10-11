# Demo recording script (30 to 45 seconds)

For the hackathon video. One screen recording of the live guided demo, seven short shots, one click each. Total narration is about 100 words, which reads in roughly 40 seconds at a calm pace.

Live page: https://abelhubprog.github.io/approval-seal/
Repo: https://github.com/Abelhubprog/approval-seal

## Before you hit record

1. Use a fresh browser window, no extensions, bookmarks bar hidden. Light or dark mode both work.
2. Window about 1280 x 720, browser zoom 125% so the text reads on a small video. For a phone-style take use a 390 px wide window instead.
3. Open the page. It starts on the **Demo** tab at "Step 1 of 7". If you already clicked through, press **Reset**.
4. Do one dry run first. Step 7 calls Hyperliquid's public API, so check you are online and that it ends with `4 of 4 receipts verified, no login`. Press **Reset** again before the real take.
5. Close anything that shows private data. The page never asks for a key, wallet or login, and none should be on screen.

## Shots

| # | Time | Exact clicks | Narration (say this) |
|---|---|---|---|
| 1 | 0:00 to 0:05 | Click **Show the proposed order**. Pause one beat on the JSON and the yellow EXAMPLE DATA banner. | "An AI agent proposes an order. This is example data. No real trade is placed." |
| 2 | 0:05 to 0:10 | Click **Next step**, then **Approve and seal**. Pause on the `action_hash` and `seal`. | "I approve it, and the exact order is sealed with a SHA-256 hash." |
| 3 | 0:10 to 0:14 | Click **Next step**, then **Verify the record**. Hold on the green VERIFIED bar. | "Anyone can verify it. Green." |
| 4 | 0:14 to 0:21 | Click **Next step**, then **Change the amount: 0.0100 to 10.0000**. Hold on the red bar and the line `action.size: 0.0100 to 10.0000`. | "Now someone changes the amount after approval. It fails, and the check names the exact field." |
| 5 | 0:21 to 0:27 | Click **Next step**, then **Forge it: edit and recompute the hashes**. Hold on `REJECTED: expected_seal`. | "A smarter attacker recomputes the hashes too. It still fails against the stored seal." |
| 6 | 0:27 to 0:31 | Click **Next step**, then **Claim the same approval twice**. Hold on `REJECTED: not_replayed`. | "And an approval works once. The second use is rejected." |
| 7 | 0:31 to 0:40 | Click **Next step**, then **Check the public record**. Wait about two seconds for the green bar `4 of 4 receipts verified, no login`. | "Finally, we check real public Hyperliquid orders. No login. Four of four verified." |
| 8 | 0:40 to 0:45 | Click **Next step** (it reads Finish). The wrap-up box appears. Hold on it, then on the repo link. | "It proves the record is unchanged since approval. Not who approved, and not profit. It is open source." |

Narration in one block, for a voiceover take:

> An AI agent proposes an order. This is example data. No real trade is placed. I approve it, and the exact order is sealed with a SHA-256 hash. Anyone can verify it. Green. Now someone changes the amount after approval. It fails, and the check names the exact field. A smarter attacker recomputes the hashes too. It still fails against the stored seal. And an approval works once. The second use is rejected. Finally, we check real public Hyperliquid orders. No login. Four of four verified. It proves the record is unchanged since approval. Not who approved, and not profit. It is open source.

## Tips

- Click slowly and pause about one second on each result so viewers can read it. Do not type anything.
- If a step is too long for the time you have, shorten the narration but keep the clicks. Shots 3 and 6 are the easiest to trim.
- If step 7 shows an error (no network), click **Check the public record** again. If it keeps failing, record shots 1 to 6 and do shot 7 from the terminal below.
- Say "example data" when you show the order and the public receipts. The four public orders belong to a third-party wallet. They are not receipts from your own product and were not made with approval-seal.
- Do not say audited, secure, regulated, profitable or "proves who approved". The page itself says what it does not prove, so you can point at those boxes.

## Terminal alternative (same flow, 30 seconds)

Use this for a vertical video or if the browser is not an option.

1. Run `python3 examples/demo.py --online` in a terminal with a large font. Output scrolls through seven numbered steps with green PASS and red FAIL.
2. Narrate the same lines as shots 1 to 7, and end on `4 of 4 receipts verified, no login` and `All steps behaved as expected.`
3. Add `--fixed` if you want identical hashes on every take.

## What the video must not claim

- The sample order is made up and was never sent anywhere.
- The seal does not prove who approved. Version 0.1.0 has no signature.
- Public orders in step 7 are third-party examples, not results from your own agent.
- No claim about profit, safety or an audit.
