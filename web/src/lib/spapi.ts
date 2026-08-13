/**
 * A small Selling Partner API client — only what the reports flow needs.
 *
 * This is the one place in the project that talks to Amazon over the network,
 * and it is worth being precise about why that is safe when scraping is not.
 * SP-API is the interface Amazon publishes for exactly this, called with the
 * seller's own credentials, against documented rate limits. It is not the
 * pattern that gets an address throttled; that is unauthenticated requests for
 * shopper-facing pages at volume, which nothing here does.
 *
 * SP-API dropped its AWS SigV4 requirement, so a call is now a plain HTTPS
 * request carrying an access token. That access token lasts an hour and is
 * minted from a refresh token that does not expire.
 *
 * `fetchImpl` is injectable so the whole flow can be tested against recorded
 * responses rather than a live account.
 */

export interface SpApiConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Which endpoint: Amazon groups marketplaces into three regions. */
  region: "eu" | "na" | "fe";
  marketplaceId: string;
}

export type Fetch = typeof fetch;

const ENDPOINTS: Record<SpApiConfig["region"], string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

/**
 * Amazon publishes sandbox endpoints alongside the live ones, and pointing at
 * them is how a connection is exercised without touching a real account. Both
 * URLs are therefore overridable; unset, they are the live ones.
 */
const endpointFor = (region: SpApiConfig["region"]) =>
  process.env.SPAPI_ENDPOINT ?? ENDPOINTS[region];
const tokenUrl = () => process.env.SPAPI_TOKEN_URL ?? LWA_TOKEN_URL;

/**
 * Marketplaces, their IDs and which region endpoint serves them.
 * India sits in the European region, which is not obvious and is a common
 * cause of a first connection failing with an unhelpful error.
 */
export const MARKETPLACE_IDS: Record<string, { id: string; region: SpApiConfig["region"]; label: string }> = {
  IN: { id: "A21TJRUUN4KGV", region: "eu", label: "India — amazon.in" },
  US: { id: "ATVPDKIKX0DER", region: "na", label: "USA — amazon.com" },
  CA: { id: "A2EUQ1WTGCTBG2", region: "na", label: "Canada — amazon.ca" },
  MX: { id: "A1AM78C64UM0Y8", region: "na", label: "Mexico — amazon.com.mx" },
  BR: { id: "A2Q3Y263D00KWC", region: "na", label: "Brazil — amazon.com.br" },
  UK: { id: "A1F83G8C2ARO7P", region: "eu", label: "UK — amazon.co.uk" },
  DE: { id: "A1PA6795UKMFR9", region: "eu", label: "Germany — amazon.de" },
  FR: { id: "A13V1IB3VIYZZH", region: "eu", label: "France — amazon.fr" },
  IT: { id: "APJ6JRA9NG5V4", region: "eu", label: "Italy — amazon.it" },
  ES: { id: "A1RKKUPIHCS9HS", region: "eu", label: "Spain — amazon.es" },
  NL: { id: "A1805IZSGTT6HS", region: "eu", label: "Netherlands — amazon.nl" },
  SE: { id: "A2NODRKZP88ZB9", region: "eu", label: "Sweden — amazon.se" },
  PL: { id: "A1C3SOZRARQ6R3", region: "eu", label: "Poland — amazon.pl" },
  TR: { id: "A33AVAJ2PDY3EV", region: "eu", label: "Turkey — amazon.com.tr" },
  AE: { id: "A2VIGQ35RCS4UG", region: "eu", label: "UAE — amazon.ae" },
  SA: { id: "A17E79C6D8DWNP", region: "eu", label: "Saudi Arabia — amazon.sa" },
  SG: { id: "A19VAU5U5O7RUS", region: "fe", label: "Singapore — amazon.sg" },
  AU: { id: "A39IBJ37TRP1C6", region: "fe", label: "Australia — amazon.com.au" },
  JP: { id: "A1VC38T7YXB528", region: "fe", label: "Japan — amazon.co.jp" },
};

export class SpApiError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status: number, detail = "") {
    super(message);
    this.name = "SpApiError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Turns Amazon's errors into something a seller can act on. The raw responses
 * name internal concepts and say nothing about which of the several setup
 * steps was missed.
 */
export function explain(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (status === 401 || lower.includes("invalid_grant")) {
    return "Amazon rejected the refresh token. It is usually copied incompletely, or the app was "
      + "re-authorised since, which issues a new one. Re-authorise in Seller Central and paste the new token.";
  }
  if (lower.includes("invalid_client")) {
    return "Amazon rejected the client ID or secret. These come from the app you created under "
      + "Develop Apps — check for a trailing space when pasting.";
  }
  if (status === 403) {
    return "Authenticated, but this app is not allowed that data. In Seller Central, edit the app and "
      + "tick the Brand Analytics role, then re-authorise — role changes need a fresh token.";
  }
  if (status === 429) {
    return "Amazon is rate limiting. The pull will retry on the next scheduled run; nothing is lost.";
  }
  if (status >= 500) return "Amazon's API is having trouble. This usually clears on its own.";
  return body.slice(0, 300) || `Request failed with status ${status}.`;
}

interface CachedToken { token: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>();

/**
 * An access token for these credentials, minted only when the cached one is
 * within a minute of expiring. Amazon's token endpoint is itself rate limited,
 * and a report pull makes several calls.
 */
export async function accessToken(config: SpApiConfig, fetchImpl: Fetch = fetch): Promise<string> {
  const cacheKey = config.refreshToken.slice(-24);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const response = await fetchImpl(tokenUrl(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
  });

  const text = await response.text();
  if (!response.ok) throw new SpApiError(explain(response.status, text), response.status, text);

  const json = JSON.parse(text) as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  });
  return json.access_token;
}

/** Drops any cached token — used when credentials change. */
export function forgetTokens(): void {
  tokenCache.clear();
}

async function call(
  config: SpApiConfig, path: string,
  init: RequestInit & { query?: Record<string, string> } = {},
  fetchImpl: Fetch = fetch
): Promise<any> {
  const token = await accessToken(config, fetchImpl);
  const url = new URL(endpointFor(config.region) + path);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

  const response = await fetchImpl(url.toString(), {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-amz-access-token": token,
      "content-type": "application/json",
      accept: "application/json",
    },
  });

  const text = await response.text();
  if (!response.ok) throw new SpApiError(explain(response.status, text), response.status, text);
  return text ? JSON.parse(text) : {};
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

/**
 * Brand Analytics search terms — the report carrying Search Frequency Rank,
 * and the top three ASINs clicked for each term. Both halves matter here: the
 * rank is the volume figure, and the clicked ASINs are what makes a reverse
 * lookup possible.
 */
export const SEARCH_TERMS_REPORT = "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT";

export type ReportPeriod = "WEEK" | "MONTH" | "QUARTER";

export async function requestReport(
  config: SpApiConfig,
  options: { reportType?: string; period?: ReportPeriod; from?: Date; to?: Date } = {},
  fetchImpl: Fetch = fetch
): Promise<string> {
  const body: Record<string, unknown> = {
    reportType: options.reportType ?? SEARCH_TERMS_REPORT,
    marketplaceIds: [config.marketplaceId],
    reportOptions: { reportPeriod: options.period ?? "WEEK" },
  };
  if (options.from) body.dataStartTime = options.from.toISOString();
  if (options.to) body.dataEndTime = options.to.toISOString();

  const result = await call(config, "/reports/2021-06-30/reports", {
    method: "POST",
    body: JSON.stringify(body),
  }, fetchImpl);
  return result.reportId as string;
}

export interface ReportStatus {
  processingStatus: "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "FATAL";
  reportDocumentId?: string;
}

export async function reportStatus(
  config: SpApiConfig, reportId: string, fetchImpl: Fetch = fetch
): Promise<ReportStatus> {
  return call(config, `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`, {}, fetchImpl);
}

/**
 * Downloads a finished report.
 *
 * The document arrives as a URL to fetch separately, often gzipped. Decoding
 * is left to the caller so this stays testable without a compression round
 * trip in every test.
 */
export async function reportDocument(
  config: SpApiConfig, documentId: string, fetchImpl: Fetch = fetch
): Promise<{ url: string; compression?: string }> {
  const doc = await call(
    config, `/reports/2021-06-30/documents/${encodeURIComponent(documentId)}`, {}, fetchImpl
  );
  return { url: doc.url, compression: doc.compressionAlgorithm };
}

/** Waits for a report, with the backoff Amazon's own guidance asks for. */
export async function waitForReport(
  config: SpApiConfig, reportId: string,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  fetchImpl: Fetch = fetch
): Promise<string> {
  const attempts = options.attempts ?? 20;
  const delay = options.delayMs ?? 15_000;
  const sleep = options.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));

  for (let i = 0; i < attempts; i++) {
    const status = await reportStatus(config, reportId, fetchImpl);
    if (status.processingStatus === "DONE" && status.reportDocumentId) return status.reportDocumentId;
    if (status.processingStatus === "CANCELLED") {
      // Amazon cancels rather than fails when a period holds no data.
      throw new SpApiError(
        "Amazon cancelled the report, which normally means there is no Brand Analytics data for "
        + "that period yet. Search terms data appears a few days after each week closes.", 200);
    }
    if (status.processingStatus === "FATAL") {
      throw new SpApiError("Amazon could not produce the report. Try a different period.", 200);
    }
    await sleep(delay);
  }
  throw new SpApiError(
    "The report is still processing after several minutes. The next scheduled run will pick it up.", 202);
}
