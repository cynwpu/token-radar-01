// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// radar-2's implied value is anchored to the market itself instead of a flat multiple of TVL. The
// snapshot's token-listed protocols are the comparables: within each category their market caps trade
// at some ratio of TVL, and a pre-token protocol in the same category inherits that ratio, shrunk
// toward the whole market's median when the category has few comparables. Momentum (the 7-day TVL
// change) and maturity (days tracked with no token recorded) adjust the anchor:
//
//   ratio_c    = median(mcap_usd / tvl_usd) over the category's listed protocols
//   ratio      = (ratio_c * n_c + RATIO_GLOBAL * SHRINK) / (n_c + SHRINK)   (n_c comparables)
//   base       = tvl_usd x ratio
//   growthMult = 1 + clamp(change_7d, -50, 100) / 100 x GROWTH_WEIGHT       (unknown: 0)
//   matureMult = 0.6 + min(age_days, 1095) / 1095 x 0.4                     (unknown: 365 days)
//   implied    = max(1, round(base x growthMult x matureMult))
//
// Every figure comes from the snapshot's own rows. No protocol name is ever special-cased: the same
// function scores every row, and each row carries its own breakdown so the dashboard can show the
// arithmetic behind its number.

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

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  ratio_shrink: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  ratio_shrink: 4,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 260;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The arithmetic behind one row's implied value, so the page can show its work. */
export interface ValueBreakdown {
  comparable_ratio: number;
  comparables: number;
  ratio_global: number;
  base_usd: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
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
  model: ValueBreakdown;
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
  breakdown: ValueBreakdown;
  farm_steps: string[];
  watchlist: boolean;
}

/** A token-listed protocol, compact: the comparables pool the dashboard recomputes ratios from. */
export interface MarketRow {
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
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
  ratio_global: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  market: MarketRow[];
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

/** The middle value of a sorted copy of `xs`, or null on an empty list. */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** A category's label for grouping comparables: the snapshot's own, or a shared bucket. */
function categoryKey(p: SnapshotProtocol): string {
  return p.category ?? '(uncategorised)';
}

export interface Comparables {
  ratio_global: number;
  byCategory: Map<string, { ratio: number; count: number }>;
}

/**
 * The market's own price of TVL, from the snapshot's token-listed protocols: the median market cap
 * per dollar of TVL overall and within each category. Outliers past 50x or under 0.005x are dropped
 * as noise (a dying token's cap says nothing about a launch).
 */
export function buildComparables(snapshot: Snapshot): Comparables {
  const globalRatios: number[] = [];
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!(ratio >= 0.005 && ratio <= 50)) continue;
    globalRatios.push(ratio);
    const key = categoryKey(p);
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [ratio]);
    else list.push(ratio);
  }
  const ratioGlobal = median(globalRatios) ?? 0.3;
  const byCategory = new Map<string, { ratio: number; count: number }>();
  for (const [key, ratios] of byCat) {
    const r = median(ratios);
    if (r !== null) byCategory.set(key, { ratio: r, count: ratios.length });
  }
  return { ratio_global: ratioGlobal, byCategory };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, comps: Comparables, model: ModelConstants): { implied: number; breakdown: ValueBreakdown } {
  const age = ageDays(asOf, protocol.listed_at);
  const cat = comps.byCategory.get(categoryKey(protocol));
  const n = cat?.count ?? 0;
  const catRatio = cat?.ratio ?? comps.ratio_global;
  // Few comparables: believe the category less, the whole market more.
  const ratio = (catRatio * n + comps.ratio_global * model.ratio_shrink) / (n + model.ratio_shrink);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * ratio;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return {
    implied,
    breakdown: {
      comparable_ratio: round4(ratio),
      comparables: n,
      ratio_global: round4(comps.ratio_global),
      base_usd: Math.round(base),
      growth_pct: round4(growthPct),
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      age_days: age,
    },
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; ratio_global: number } {
  const index = bySlug(snapshot.protocols);
  const comps = buildComparables(snapshot);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, comps, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
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
    token_status: 'pre-token' as const,
    age_days: s.breakdown.age_days,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown.age_days).map(stepText),
  }));
  return { board, ratio_global: comps.ratio_global };
}

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

/** A rough per-transaction gas budget on the chain, in whole dollars. */
function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('solana') || c.includes('sui') || c.includes('aptos') || c.includes('ton')) return 1;
  if (c.includes('ethereum')) return 12;
  if (c.includes('bitcoin')) return 6;
  return 3; // L2s, sidechains and alt L1s are cheap
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

/** The category's main action and its weekly follow-up, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): { main: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      main: `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount (about 25% of the supply) against it so both sides of the market register.`,
      weekly: 'Each week repay a slice of the loan and borrow it again, so the position keeps producing fresh activity.',
    };
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return {
      main: `Provide $${capital} of liquidity to ${name}'s busiest pool on ${chain}, split between the two pool assets, and keep the LP position open.`,
      weekly: 'Each week make one small swap through the pool and compound any fees the position earned.',
    };
  }
  if (c.includes('yield')) {
    return {
      main: `Deposit $${capital} into ${name}'s flagship vault on ${chain} and keep the vault shares in the same wallet.`,
      weekly: 'Each week harvest or restake whatever the vault paid out so the wallet shows repeated use.',
    };
  }
  if (c.includes('bridge')) {
    return {
      main: `Bridge $${capital} of USDC to ${chain} through ${name}, then put the bridged funds to work in one app on the destination chain.`,
      weekly: 'Each week move a small amount back and forth so the bridge records volume from your wallet.',
    };
  }
  if (c.includes('restak')) {
    return {
      main: `Restake $${capital} of the chain's staking asset through ${name} and keep the restaking receipt in the wallet.`,
      weekly: 'Each week check the points page and delegate or re-delegate if the protocol asks for it.',
    };
  }
  if (c.includes('staking')) {
    return {
      main: `Stake $${capital} of the chain's staking asset through ${name} and keep the liquid staking receipt.`,
      weekly: 'Each week use the receipt once, for example as collateral or in a small swap, so the wallet stays active.',
    };
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return {
      main: `Deposit $${capital} of USDC as margin on ${name} and open one small hedge: long and short the same size so price risk cancels.`,
      weekly: 'Each week close and reopen the hedge so the account records regular trading volume.',
    };
  }
  if (c.includes('prediction')) {
    return {
      main: `Fund ${name} with $${capital} and place one small position on a market you understand, sized so a loss is acceptable.`,
      weekly: 'Each week add or adjust one position so the account keeps a record of use.',
    };
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return {
      main: `Deposit $${capital} into one of ${name}'s curated vaults on ${chain} and keep the shares.`,
      weekly: `Each week review the vault's allocation and restake any rewards it distributed.`,
    };
  }
  if (c.includes('stable')) {
    return {
      main: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the wallet.`,
      weekly: 'Each week move a small amount between the stable asset and USDC so the wallet shows activity.',
    };
  }
  if (c.includes('rwa')) {
    return {
      main: `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it in the wallet.`,
      weekly: 'Each week check the accrued yield and restake or claim it if the protocol pays out.',
    };
  }
  if (c.includes('insurance')) {
    return {
      main: `Buy $${capital} of cover from ${name} on ${chain} on a protocol you actually use, and keep the policy until it expires.`,
      weekly: 'Each week review open covers and renew or adjust one so the account stays active.',
    };
  }
  return {
    main: `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open.`,
    weekly: 'Each week make one qualifying action in the app, such as a deposit, withdrawal, swap or vote.',
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names; the same generator writes every row's plan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasUsd(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const { main, weekly } = actionFor(p, capital, chain);
  return [
    {
      text: `Create a fresh wallet used only for farming ${p.name}, fund it with no more than you can lose, and store its seed phrase offline.`,
      cost: 'nothing but care',
      time: '10 minutes',
    },
    {
      text: `Move about $${capital + 4 * gas} to ${chain}: withdraw from an exchange that supports it, or bridge in, and keep $${4 * gas} aside for gas.`,
      cost: `$${capital} of capital plus about $${4 * gas} of gas reserve`,
      time: '20 minutes',
    },
    {
      text: main,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the wallet's activity is counted across more than one snapshot of the chain.`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before any claim, open ${p.name}'s own points or rewards page from its official app and claim only through the link it publishes there.`,
      cost: 'no fee to check, and never pay a third party to claim',
      time: '10 minutes',
    },
    {
      text: `Keep a farm log of the wallet, the dates and every transaction id, so you can prove activity, repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes a week',
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
export function radarRow(row: BoardRow, watchlist: ReadonlySet<string>): RadarRow {
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
    breakdown: row.model,
    farm_steps: row.farm_steps,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, ratio_global } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    ratio_global: round4(ratio_global),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
    live,
    market: marketRows(snapshot),
  };
  return { board, radar };
}

/** The token-listed protocols the dashboard recomputes comparable ratios from, compact. */
export function marketRows(snapshot: Snapshot): MarketRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0)
    .map((p) => ({ category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! }));
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
