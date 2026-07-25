import { cookies } from '@/next/headers'
import {
  DEFAULT_DETAIL_SIDEBAR_MODE,
  DETAIL_SIDEBAR_COOKIE_NAME,
  parseDetailSidebarMode,
} from './preference'

export async function getInitialDetailSidebarMode() {
  const cookieStore = await cookies()

  return (
    parseDetailSidebarMode(cookieStore.get(DETAIL_SIDEBAR_COOKIE_NAME)?.value) ??
    DEFAULT_DETAIL_SIDEBAR_MODE
  )
}
