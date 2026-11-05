import type { ConsumerAppResponse } from '@dify/contracts/api/web/types.gen'

export type EndUserApp = ConsumerAppResponse

export type AppListFilter = {
  view: 'all' | 'starred'
  sort: 'last-used' | 'name' | 'name-desc'
  q: string
}

export function sortApps(
  apps: readonly EndUserApp[],
  sort: AppListFilter['sort'],
  locale?: string,
) {
  return [...apps].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, locale)
    if (sort === 'name-desc') return b.name.localeCompare(a.name, locale)
    return (b.last_used_at ?? 0) - (a.last_used_at ?? 0) || a.name.localeCompare(b.name, locale)
  })
}
