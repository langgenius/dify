/**
 * How long a server render may wait for Marketplace data before giving up on
 * server-side rendering it.
 *
 * The catalog routes prefetch on the server so results land in the initial HTML
 * (crawlers, first paint). Awaiting that prefetch to completion makes the whole
 * RSC response hostage to the Marketplace API: with a slow upstream the browser
 * sits on the *previous* page with no feedback, which is what "search just spins
 * forever" looks like from the outside. Measured against a 3s-delayed API, an
 * unbounded await pushed time-to-first-byte to ~7s.
 *
 * Nothing is lost when the budget expires: the client re-requests whatever is
 * missing from the dehydrated state, and TanStack Query is configured to
 * dehydrate still-pending queries, so in-flight work streams instead of
 * blocking. Server rendering degrades exactly when it is too slow to be worth
 * waiting for.
 *
 * Known limitation: the catalog spends this budget twice in sequence — banners
 * in `index.tsx`, then the prefetch in `hydration-server.tsx` — so the worst
 * case is 2x. Overlapping them means handing the started prefetch promise down
 * instead of letting `HydrateQueryClient` own it, which is a wider change than
 * bounding the waits.
 */
export const SERVER_PREFETCH_BUDGET_MS = 2_500

export async function withinServerBudget(work: Promise<unknown>): Promise<void> {
  let cancelBudget = () => {}
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SERVER_PREFETCH_BUDGET_MS)
        cancelBudget = () => clearTimeout(timer)
      }),
    ])
  } finally {
    cancelBudget()
  }
}
