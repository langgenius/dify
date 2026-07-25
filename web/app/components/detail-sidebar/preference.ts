export type DetailSidebarMode = 'expand' | 'collapse'

export const DETAIL_SIDEBAR_COOKIE_NAME = 'console-detail-sidebar-mode'
export const DEFAULT_DETAIL_SIDEBAR_MODE: DetailSidebarMode = 'expand'

export function parseDetailSidebarMode(raw: string | undefined): DetailSidebarMode | undefined {
  if (raw === 'expand' || raw === 'collapse') return raw
}
