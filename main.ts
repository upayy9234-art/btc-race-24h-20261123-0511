// Guarded Hold — a single-asset cbBTC bot for the bars-replay race.
//
// Idea: on a one-minute replay the pool's own noise dwarfs any signal a
// crossover can extract, and every round trip pays the pool fee plus
// slippage twice. So this bot trades as rarely as it can while still being
// fully exposed to the day's drift:
//
//   1. Entry. On the first batch it may trade on, it spends most of its
//      cash on the universe's first priced symbol and then sits still.
//      A small cash buffer stays behind so a rejected or partial first
//      fill never leaves the bot unable to act later.
//   2. Disaster stop. If the position's marked value falls to 96% of its
//      cost (fees included), the whole position is sold. One bad day is
//      capped near -4% instead of riding a collapse to the flatten.
//   3. Trailing guard. Once the position has been worth 103% of cost,
//      a fall back to 98.5% of the best value seen sells everything:
//      a real run-up is banked instead of handed back bar by bar.
//   4. Re-entry, at most twice. After a stop-out the bot waits at least
//      90 bars, and buys again only when the close has climbed 1% above
//      the price at which it sold — evidence the fall actually ended,
//      not a dead bounce it would pay fees to chase.
//
// All thresholds are compared in integer micro-USDC (bigint ratios), so
// the same bars always produce the same orders. Prices are only read at
// batch closes; orders fill at the next open under the slippage caps.

import { BPS, runBars, type OrderInput } from './vendor/makefun-bars.ts';

/** Share of the starting cash the first entry may spend: 23/25 = 92%. */
const ENTRY_NUM = 23n;
const ENTRY_DEN = 25n;
/** Disaster stop: sell when value <= 96/100 of cost. */
const STOP_NUM = 96n;
const STOP_DEN = 100n;
/** Trailing guard arms once value >= 103/100 of cost. */
const ARM_NUM = 103n;
const ARM_DEN = 100n;
/** Armed guard fires when value <= 985/1000 of the peak value seen. */
const TRAIL_NUM = 985n;
const TRAIL_DEN = 1000n;
/** Re-entry needs the close 1% over the exit close: 101/100. */
const REENTRY_NUM = 101n;
const REENTRY_DEN = 100n;
/** Bars to sit out after any exit before a re-entry is even considered. */
const COOLDOWN_BARS = 90;
/** Re-entries allowed after the first entry. */
const MAX_REENTRIES = 2;
/** No re-entry this late: a position opened in the window's last stretch
 *  pays a full round trip for a handful of bars of drift. The scored
 *  window is 1,440 batches, so re-entries stop after batch 1,250. */
const LAST_REENTRY_SEQ = 1250;
/** Slippage caps, in bps past the deciding close. */
const BUY_SLIPPAGE_BPS = 150;
const SELL_SLIPPAGE_BPS = 100;

interface Watch {
  /** Best marked value of the open position so far, micro-USDC. */
  peakValue: bigint;
  /** Whether the trailing guard has armed for this position. */
  armed: boolean;
}

let entered = false;
let reentriesUsed = 0;
let barsSinceExit = Number.POSITIVE_INFINITY;
let exitClose: bigint | null = null;
const watch = new Map<string, Watch>();

/** Marked value of a held quantity at the latest close, or null unpriced. */
function markedValue(state: { value(symbol: string, qty: bigint): bigint | null }, symbol: string, qty: bigint): bigint | null {
  return state.value(symbol, qty);
}

function buyOrder(symbol: string, notional: bigint): OrderInput {
  return { side: 'buy', symbol, notional_quote_units: notional, max_slippage_bps: BUY_SLIPPAGE_BPS };
}

function sellOrder(symbol: string, qty: bigint): OrderInput {
  return { side: 'sell', symbol, qty, max_slippage_bps: SELL_SLIPPAGE_BPS };
}

await runBars({
  onBatch(state) {
    const orders: OrderInput[] = [];
    if (state.warmingUp) return orders;
    barsSinceExit += 1;

    const { caps, fees } = state.hello;
    const minNotional = BigInt(fees.min_notional_quote_units);
    const weightCap = (BigInt(caps.max_weight_bps) * state.equity) / BPS;

    // ---- Exits first: a sell decided here funds nothing this reply, but
    // it must never queue behind a buy for the order cap.
    for (const [symbol, pos] of state.positions) {
      if (pos.qty === 0n) continue;
      const value = markedValue(state, symbol, pos.qty);
      if (value === null) continue;
      let w = watch.get(symbol);
      if (w === undefined) {
        w = { peakValue: value, armed: value * ARM_DEN >= pos.cost * ARM_NUM };
        watch.set(symbol, w);
      }
      if (value > w.peakValue) w.peakValue = value;
      if (value * ARM_DEN >= pos.cost * ARM_NUM) w.armed = true;

      const disaster = value * STOP_DEN <= pos.cost * STOP_NUM;
      const trailed = w.armed && value * TRAIL_DEN <= w.peakValue * TRAIL_NUM;
      if (disaster || trailed) {
        orders.push(sellOrder(symbol, pos.qty));
        watch.delete(symbol);
        exitClose = state.close(symbol);
        barsSinceExit = 0;
      }
    }
    if (orders.length > 0) return orders.slice(0, caps.max_orders_per_bar);

    // ---- Entry / re-entry: only flat, only one symbol, only with cash.
    if (state.positions.size === 0 && state.cash >= minNotional) {
      const priced = state.hello.symbols
        .map((s) => s.symbol)
        .filter((symbol) => state.close(symbol) !== null);
      if (priced.length > 0) {
        const symbol = priced[0];
        if (!entered) {
          let notional = (state.cash * ENTRY_NUM) / ENTRY_DEN;
          if (notional > weightCap) notional = weightCap;
          if (notional >= minNotional) {
            orders.push(buyOrder(symbol, notional));
            entered = true;
          }
        } else if (
          reentriesUsed < MAX_REENTRIES &&
          barsSinceExit >= COOLDOWN_BARS &&
          state.seq <= LAST_REENTRY_SEQ &&
          exitClose !== null
        ) {
          const close = state.close(symbol);
          if (close !== null && close * REENTRY_DEN >= exitClose * REENTRY_NUM) {
            let notional = (state.cash * ENTRY_NUM) / ENTRY_DEN;
            if (notional > weightCap) notional = weightCap;
            if (notional >= minNotional) {
              orders.push(buyOrder(symbol, notional));
              reentriesUsed += 1;
              exitClose = null;
            }
          }
        }
      }
    }
    return orders.slice(0, caps.max_orders_per_bar);
  },
});
