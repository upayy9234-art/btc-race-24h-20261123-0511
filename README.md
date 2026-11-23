# btc-race-24h-20261123-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/upayy9234-art/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/upayy9234-art/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Guarded Hold: a long-only cbBTC bot for make.fun's [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261123-0511) bounty ($50 in USDC). It trades Coinbase Wrapped BTC (CBBTC) against USDC on 1-minute bars, starting from 1,000 USDC of paper money.

## Strategy

Minute-bar noise in this pool dwarfs any crossover signal, and every round trip pays fees and slippage twice, so the bot trades as rarely as it can while staying exposed to the day's drift:

- **Entry:** on the first tradable batch, spend 92% of cash on the universe's first priced symbol; keep a small buffer behind.
- **Disaster stop:** sell everything if the position's marked value falls to 96% of its cost (fees included).
- **Trailing guard:** once the position has been worth 103% of cost, sell everything if its value falls back to 98.5% of the best value seen.
- **Re-entry (at most twice):** after an exit, wait at least 90 bars and buy again only when the close is 1% above the exit close, and never after batch 1,250 of the window.

All thresholds are integer bigint ratios on micro-USDC, so the same bars always produce the same orders — no wall clock, no randomness, no network.

## Run it

```sh
node main.ts
```

Node with TypeScript support. The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on stdin/stdout) via the vendored shim in `vendor/makefun-bars.ts`, a byte-for-byte copy of the kit's SDK shim.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
