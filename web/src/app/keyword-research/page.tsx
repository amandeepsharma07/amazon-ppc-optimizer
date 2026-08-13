import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { coverage, searchTerms, termsForAsin } from "@/lib/research";

export const dynamic = "force-dynamic";

/**
 * Magnet and Cerebro on real Brand Analytics data.
 *
 * A plain form submitting to itself: the whole screen is a query against
 * stored rows, so there is nothing for client-side state to add.
 */
export default async function KeywordResearchPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string; asin?: string; market?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const held = await coverage();
  const market = params.market || held[0]?.marketplace || "IN";
  const seed = (params.seed ?? "").trim();
  const asin = (params.asin ?? "").trim();

  const [terms, forAsin] = await Promise.all([
    seed ? searchTerms(market, seed) : Promise.resolve([]),
    asin ? termsForAsin(market, asin) : Promise.resolve([]),
  ]);

  const has = held.find(h => h.marketplace === market);

  return (
    <AppShell
      user={user}
      title="Keyword research"
      subtitle={"Search Frequency Rank straight from Brand Analytics — Amazon's own figure for how "
        + "much a term is searched, where rank 1 is the most searched of the period. Plus which "
        + "ASINs take the clicks, which makes a reverse lookup a fact rather than an estimate."}
    >
      <div className="stack">
        {!held.length ? (
          <div className="card">
            <h2 className="section">Nothing pulled yet</h2>
            <p className="hint" style={{ margin: 0 }}>
              {user.role === "admin"
                ? "Connect Selling Partner API on the Amazon connection page and pull the search terms report."
                : "An admin needs to connect Selling Partner API before this screen has anything to show."}
            </p>
          </div>
        ) : (
          <>
            <div className="card">
              <form method="get" className="row">
                <div className="narrow">
                  <label className="field-label" htmlFor="kr-market">Marketplace</label>
                  <select id="kr-market" name="market" defaultValue={market}>
                    {held.map(h => <option key={h.marketplace} value={h.marketplace}>{h.marketplace}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="kr-seed">Seed keyword — Magnet</label>
                  <input id="kr-seed" name="seed" type="text" defaultValue={seed} placeholder="laptop bag" />
                </div>
                <div>
                  <label className="field-label" htmlFor="kr-asin">Or an ASIN — Cerebro</label>
                  <input id="kr-asin" name="asin" type="text" defaultValue={asin} placeholder="B0CZ8K9LMN" />
                </div>
                <button className="btn narrow" type="submit">Search</button>
              </form>
              <p className="hint" style={{ margin: "10px 0 0" }}>
                {has
                  ? `${has.terms.toLocaleString()} terms held for ${market}, latest period starting ${has.latest}.`
                  : `No data held for ${market} yet.`}
              </p>
            </div>

            {seed && (
              <div className="card">
                <h2 className="section">Terms containing “{seed}”</h2>
                {terms.length === 0 ? (
                  <p className="hint" style={{ margin: 0 }}>
                    Nothing matched. Every word of the seed has to appear in the term — try one word.
                  </p>
                ) : (
                  <>
                    <p className="hint">
                      {terms.length} shown, most searched first. Rank is Amazon&apos;s Search Frequency
                      Rank for the whole marketplace: lower is searched more.
                    </p>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th className="num">Rank</th><th>Search term</th><th>Clicked ASINs</th></tr></thead>
                        <tbody>
                          {terms.map(t => (
                            <tr key={t.search_term}>
                              <td className="num">{t.rank.toLocaleString()}</td>
                              <td>{t.search_term}</td>
                              <td className="ell" title={t.asins ?? ""}>{t.asins ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}

            {asin && (
              <div className="card">
                <h2 className="section">Terms {asin.toUpperCase()} takes clicks on</h2>
                {forAsin.length === 0 ? (
                  <p className="hint" style={{ margin: 0 }}>
                    This ASIN is not among the top three clicked for any term held. Amazon only names
                    three ASINs per term, so a product outside them leaves no trace here.
                  </p>
                ) : (
                  <>
                    <p className="hint">
                      {forAsin.length} terms. Position is where it sat among the three most-clicked
                      products for that search — stated by Amazon, not inferred.
                    </p>
                    <div className="table-wrap">
                      <table>
                        <thead><tr>
                          <th className="num">Rank</th><th>Search term</th>
                          <th className="num">Position</th><th className="num">Click share</th>
                          <th className="num">Conversion share</th>
                        </tr></thead>
                        <tbody>
                          {forAsin.map(t => (
                            <tr key={t.search_term}>
                              <td className="num">{t.rank.toLocaleString()}</td>
                              <td>{t.search_term}</td>
                              <td className="num">#{t.position}</td>
                              <td className="num">{t.click_share === null ? "—" : `${(t.click_share * 100).toFixed(1)}%`}</td>
                              <td className="num">{t.conversion_share === null ? "—" : `${(t.conversion_share * 100).toFixed(1)}%`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
