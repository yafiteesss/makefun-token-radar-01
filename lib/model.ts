// Token Radar's model, version radar-2: one snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling) and adds every rankable pre-token protocol below the watchlist floor
// the snapshot holds. "Rankable" is pre-token, not a CEX, and not a versioned
// pool name. On this snapshot that early set is 186 protocols, not 200: the
// snapshot holds 210 pre-token protocols below the floor, 9 of them CEX and 15
// versioned pools. It then adds the 14 largest above-floor protocols that pass
// the watchlist's own exclusion rules (see isWatchlistEligible): pre-token,
// at or above the floor, and not a wrapped, staked or bridged product of a
// token that already trades, judged only on the fields the snapshot carries.
// The snapshot carries no parentProtocol field, so the rule is applied on
// category, name and the token fields it does carry; a protocol the house's
// list leaves out for a parent it records elsewhere is still judged here on
// what the snapshot shows. 40 + 186 + 14 = 240 rows. WBTC, Binance staked
// ETH and the bridges stay out because each is a wrapped or staked product
// of a token that already trades, not a protocol still waiting on a launch
// of its own.
//
// Implied value follows only from the snapshot's own figures:
//
//   base       = tvl_usd x BASE_MULTIPLE                         (0.25)
//   growth     = clamp(change_7d, -40, 80) per cent            (null -> 0)
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT            (0.6)
//   maturity   = 0.55 + min(age_days, 1460) / 1460 x 0.45      (age unknown: 365d)
//                capped at 0.85 when change_7d is null, because an unreported
//                week gives no evidence the protocol is still growing
//   chainMult  = 1.00 on 1 chain, 1.05 on 2-3, 1.10 on 4-9, 1.15 on 10+
//   catMult    = CATEGORY_MULTIPLIER[category] (1.00 when unlisted)
//   implied    = max(1, round(base x growthMult x maturity x chainMult x catMult))
//
// CATEGORY_MULTIPLIER is keyed by the snapshot's category string only, never
// by protocol name. Wrapped, staked and bridged products are penalised
// because their token, if any, would be a claim on a token that already
// trades; Lending, Dexs, RWA and Yield get a small premium because a token
// is the more plausible launch for them. No protocol name is ever
// special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  growth_unknown_maturity_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.6,
  growth_floor: -40,
  growth_cap: 80,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  growth_unknown_maturity_cap: 0.85,
};

/**
 * Category adjustment, keyed by the snapshot's category string. Wrapped,
 * staked and bridged products are discounted (their launch, if any, is a
 * claim on a token that already trades); categories where a token is the
 * more plausible launch get a small premium. Anything unlisted is 1.00.
 */
export const CATEGORY_MULTIPLIER: Record<string, number> = {
  // Wrapped / staked / bridged products of a token that already trades.
  'Bridge': 0.7,
  'Canonical Bridge': 0.7,
  'Cross Chain Bridge': 0.7,
  'Liquid Staking': 0.75,
  'Liquid Restaking': 0.75,
  'Restaked BTC': 0.75,
  'Restaking': 0.8,
  'Staking Pool': 0.85,
  'Stablecoin Wrapper': 0.75,
  'CEX': 0.7,
  // A token is the more plausible launch here.
  'Lending': 1.08,
  'Dexs': 1.08,
  'RWA': 1.08,
  'Yield': 1.05,
  'CDP': 1.05,
  'Risk Curators': 1.05,
  'Onchain Capital Allocator': 1.05,
  'Yield Aggregator': 1.03,
  'Derivatives': 1.03,
  'Prediction Market': 1.05,
  'Launchpad': 1.05,
  'Governance Incentives': 1.05,
  'Collateral Markets': 1.05,
};

/** The category multiplier for one protocol: the table, or 1.00 when unlisted. */
export function categoryMultiplier(category: string | null): number {
  if (category === null) return 1;
  return CATEGORY_MULTIPLIER[category] ?? 1;
}

/** The chain-diversity multiplier: 1 chain 1.00, 2-3 1.05, 4-9 1.10, 10+ 1.15. */
export function chainMultiplier(chainCount: number): number {
  if (chainCount >= 10) return 1.15;
  if (chainCount >= 4) return 1.1;
  if (chainCount >= 2) return 1.05;
  return 1;
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** Cap on pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 200;

/** How many above-floor protocols the radar adds: the largest that pass isWatchlistEligible, by TVL. */
export const ABOVE_FLOOR_ROWS = 14;

/** Categories the watchlist rule excludes: wrapped, staked or bridged products, and exchanges. */
export const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
  'Stablecoin Wrapper',
]);

/** Exchange names the watchlist rule excludes when a protocol's name begins with one. */
export const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word wrapped, staked or staking in a name: a wrapped or staked product, not a fresh launch. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name. */
function beginsWithExchange(name: string): boolean {
  return EXCHANGE_NAMES.some((e) => new RegExp(`^${e}\\b`, 'i').test(name));
}

/**
 * Whether a protocol at or above the watchlist floor passes the watchlist's
 * own exclusion rules, judged only on the fields the snapshot carries
 * (the snapshot has no parentProtocol field): pre-token, category not one
 * of the excluded wrapped/staked/bridged/exchange categories, name not
 * ending in a version marker, no whole word wrapped/staked/staking, and
 * name not beginning with an exchange's name. No slug or name is ever
 * special-cased: the same rule admits or rejects every candidate.
 */
export function isWatchlistEligible(p: SnapshotProtocol, floorUsd: number): boolean {
  if (!isPreToken(p)) return false;
  if (p.tvl_usd < floorUsd) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (beginsWithExchange(p.name)) return false;
  return true;
}

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    base_value_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    category_multiplier: number;
    growth_unknown: boolean;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_value_usd: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  category_multiplier: number;
  growth_unknown: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): {
  implied: number;
  base: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  categoryMult: number;
  growthUnknown: boolean;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const growthUnknown = protocol.change_7d === null || !Number.isFinite(protocol.change_7d);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  let maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  // No reported week: treat growth as 0 and cap the maturity credit, so an
  // unreported protocol cannot outrank a growing one on age alone.
  if (growthUnknown) maturityMult = Math.min(maturityMult, model.growth_unknown_maturity_cap);
  const chainMult = chainMultiplier(protocol.chains.length);
  const categoryMult = categoryMultiplier(protocol.category);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult * categoryMult));
  return { implied, base, growthPct, growthMult, maturityMult, chainMult, categoryMult, growthUnknown, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor,
  // by TVL, capped. On this snapshot the complete set is 186 rows (see the
  // header note); a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  // Above the floor: the largest protocols that pass the watchlist's own
  // exclusion rules (isWatchlistEligible), by TVL, capped at 14. These are
  // the watchlist's misses on the snapshot's own fields — a Risk Curator or
  // a Lending protocol above $50M that records no token — not the wrapped
  // and staked products the rule excludes, which isWatchlistEligible
  // rejects by category and name before TVL is ever looked at.
  const aboveFloor = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isWatchlistEligible(p, snapshot.floor_usd))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, ABOVE_FLOOR_ROWS);
  for (const p of aboveFloor) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      base_value_usd: Math.round(s.base),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      category_multiplier: round4(s.categoryMult),
      growth_unknown: s.growthUnknown,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the shares.`;
  if (c.includes('launchpad')) return `Commit $${capital} of USDC to a ${name} launch on ${chain} and keep the allocation.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different action in the same protocol, so the plan is not one deposit and a wait. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${small} against the supplied collateral, then repay it within the week so the account shows both sides of the market.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $${small} through ${name}'s main pool on ${chain} so the wallet records a trade as well as the liquidity position.`;
  if (c.includes('bridge')) return `Use the bridged funds in a second app on ${chain} within a day, so the bridge is a transfer you used, not a balance you parked.`;
  if (c.includes('staking') || c.includes('restak')) return `Check the receipt token's peg against the staked asset before the week ends, and record the rate in the farm log.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge after a few days and record the funding paid, so the account shows a completed trade.`;
  if (c.includes('prediction')) return `Settle the first market position and withdraw the winnings to the same wallet, keeping the receipt.`;
  if (c.includes('curator') || c.includes('allocator')) return `Compare the vault's allocation on ${name} with last week's and note any strategy change in the farm log.`;
  if (c.includes('stable')) return `Redeem a small part of the stable position back to USDC to confirm the redemption path works.`;
  if (c.includes('rwa')) return `Read the issuer's latest attestation for the yield asset and note its date in the farm log.`;
  if (c.includes('insurance')) return `Read the cover's terms for the event it insures and note the expiry date in the farm log.`;
  return `Make a second, different action in ${name} on ${chain}, such as a swap or a vote, so the wallet shows more than one deposit.`;
}

/** The named risk of this category, in plain words, so the plan warns before it asks for money. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('bridge')) return `Bridge risk: a bridge can delay or fail on the destination chain, and the bridged asset can trade below its peg while in transit; never bridge more than you can wait a week to recover.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Liquidation risk: a leveraged position can be liquidated in a fast move; keep the position small and the margin well above the liquidation price.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Liquidation risk: if the collateral's price falls, the position can be liquidated; keep any loan well below the maximum the protocol allows.`;
  if (c.includes('staking') || c.includes('restak')) return `Slashing and depeg risk: the receipt token can trade below the staked asset, and the validator can be slashed; check the peg before you stake.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Impermanent-loss risk: providing liquidity can lose value against simply holding the assets when their prices move apart; check the pool's range first.`;
  if (c.includes('rwa')) return `Issuer and custody risk: the yield asset depends on its issuer and custodian; read the issuer's attestation before you mint, and never treat it as a bank deposit.`;
  if (c.includes('stable')) return `Depeg risk: the stable asset can trade below its peg; check its redemption path and reserves before you hold a large amount.`;
  if (c.includes('insurance')) return `Cover risk: a claim can be denied if the event falls outside the policy's terms; read the terms before you pay for cover.`;
  return `Smart-contract risk: the protocol's contracts can hold a bug; never deposit more than you can afford to lose, and never share a seed phrase with any site.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time.
 * Derived from the protocol's own record (category, chains, TVL, age), never
 * from a hand-written list of names. It says the protocol records no token,
 * never that it has none, and it promises no airdrop: the steps farm the
 * protocol if it launches, they do not claim it will.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about $2 of gas, on top of the $${capital} position`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from the link it publishes and check whether this wallet is eligible.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: riskFor(p),
      cost: 'nothing to read, and it can save the whole position',
      time: '5 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_value_usd: row.model.base_value_usd,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    category_multiplier: row.model.category_multiplier,
    growth_unknown: row.model.growth_unknown,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: [...snapshot.watchlist].sort(),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
