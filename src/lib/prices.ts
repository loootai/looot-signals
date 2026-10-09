import { PRICES_AS_OF, SOURCES } from "./sources";

/** Price per call (or per result) in micros for each endpoint id. */
export type PriceMap = Record<string, number>;

/** Every endpoint id this app can call. */
export const ENDPOINT_IDS: string[] = Object.values(SOURCES).map((s) => s.endpointId);

/** Prices dated PRICES_AS_OF, used for --dry-run and demo mode, and shown when the catalog cannot be read. */
export const FALLBACK_PRICES: PriceMap = Object.fromEntries(Object.values(SOURCES).map((s) => [s.endpointId, s.fallbackMicros]));

export interface PriceResult {
  prices: PriceMap;
  pricesAsOf: string;
  source: "catalog" | "fallback";
  /** Endpoints whose live price could not be read just now. The engine refuses to call them. */
  unread: string[];
}

interface CatalogItem {
  price?: { state?: string; amountMicros?: number; unit?: string } | null;
}

/** Reads the price in micros from one public catalog item. null when it has no known price. */
export function priceOfItem(item: CatalogItem | null | undefined): number | null {
  const p = item?.price;
  if (!p || p.state !== "known" || typeof p.amountMicros !== "number" || p.amountMicros < 0) return null;
  return Math.round(p.amountMicros);
}

/**
 * Free, no token needed. Reads current prices for the given endpoints from the public catalog.
 * Any endpoint that cannot be read keeps its dated fallback price for display and is named in `unread`.
 */
export async function fetchPrices(endpointIds: string[] = ENDPOINT_IDS, opts: { baseUrl?: string; fetch?: typeof fetch; now?: Date; demo?: boolean } = {}): Promise<PriceResult> {
  if (opts.demo) return { prices: { ...FALLBACK_PRICES }, pricesAsOf: `${PRICES_AS_OF}T09:00:00.000Z`, source: "fallback", unread: [] };
  const base = (opts.baseUrl ?? process.env.LOOOT_API_URL ?? "https://api.looot.ai").replace(/\/+$/, "");
  const f = opts.fetch ?? fetch;
  const prices: PriceMap = { ...FALLBACK_PRICES };
  const unread: string[] = [];
  await Promise.all(
    endpointIds.map(async (id) => {
      try {
        const res = await f(`${base}/v1/public-catalog/${encodeURIComponent(id)}`);
        const price = res.ok ? priceOfItem((await res.json()) as CatalogItem) : null;
        if (price === null) unread.push(id);
        else prices[id] = price;
      } catch {
        unread.push(id);
      }
    }),
  );
  if (unread.length > 0) return { prices, pricesAsOf: `${PRICES_AS_OF}T00:00:00.000Z`, source: "fallback", unread };
  return { prices, pricesAsOf: (opts.now ?? new Date()).toISOString(), source: "catalog", unread: [] };
}
