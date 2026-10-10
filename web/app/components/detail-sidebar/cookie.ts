export type DetailSidebarMode = 'expand' | 'collapse'

export const DETAIL_SIDEBAR_COOKIE_NAME = 'console-detail-sidebar-mode'

export function parseDetailSidebarMode(value: string | undefined): DetailSidebarMode {
  return value === 'collapse' ? 'collapse' : 'expand'
}
