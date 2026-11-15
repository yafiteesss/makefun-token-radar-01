# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yafiteesss/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yafiteesss/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A Node program that builds a token launch radar: it reads the sealed
DefiLlama snapshot, ranks the protocols that record no token by an implied
value, and writes a static dashboard with a farm plan for each one.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `out/board.json` (240 rows), `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. The board covers all 40 watchlist
protocols plus the 186 rankable pre-token protocols below the $50M floor —
every one the snapshot holds — plus the 14 largest above-floor protocols
that pass the watchlist's own exclusion rules (pre-token, not a Bridge,
Liquid Staking, Restaking, CEX or Stablecoin Wrapper product, no version
marker in the name, no whole word wrapped/staked/staking, not named after an
exchange), judged only on the fields the snapshot carries, since it has no
parentProtocol field. The 24 largest live-token protocols are set
aside in the dashboard with their market caps, not mixed into the ranking.

## Model (radar-2)

```
implied = round( tvl_usd x 0.25
  x (1 + clamp(change_7d, -40, 80) / 100 x 0.6)
  x (0.55 + min(age_days, 1460) / 1460 x 0.45)
  x chain(1.00 / 1.05 / 1.10 / 1.15 for 1 / 2-3 / 4-9 / 10+ chains)
  x category )
```

Category, keyed by the snapshot's category string only: Bridge, Canonical
Bridge and Cross Chain Bridge 0.70; Liquid Staking, Liquid Restaking and
Restaked BTC 0.75; Restaking 0.80; Staking Pool 0.85; Stablecoin Wrapper
0.75; Lending, Dexs and RWA 1.08; Yield, CDP, Risk Curators, Onchain Capital
Allocator, Prediction Market, Launchpad, Governance Incentives and Collateral
Markets 1.05; Yield Aggregator and Derivatives 1.03; everything else 1.00.

When `change_7d` is unreported it is treated as 0 and the maturity
multiplier is capped at 0.85. Age unknown uses 365 days. No protocol name
is special-cased. "Records no token" means the snapshot carries no market
cap, CoinGecko id or symbol for the protocol; it is not proof it has none,
and the implied value does not say whether or when a token launches.

## Dashboard

The board is sortable (implied value, TVL, 7-day growth, age, name — from
the Sort by control or by clicking a column header) and filterable by
search, category, chain, minimum TVL and watchlist-only. Age sorting puts
protocols with no reported listing date last. A "7-Day Movers" panel above
the board shows the five biggest seven-day TVL gainers and the five biggest
decliners, each with its rank, 7-day change, TVL and implied value;
selecting any mover, or any board row, opens its detail view with the model
breakdown and farm plan.

---

<sub>Entered on [make.fun](https://make.fun/?ref=tgs239he&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
