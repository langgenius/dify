'use client'

import type { DetailSidebarMode } from './cookie'
import { atom } from 'jotai'
import Cookies from 'js-cookie'
import { DETAIL_SIDEBAR_COOKIE_NAME } from './cookie'

export const detailSidebarModeAtom = atom<DetailSidebarMode>('expand')

export const setDetailSidebarModeAtom = atom(null, (_get, set, mode: DetailSidebarMode) => {
  set(detailSidebarModeAtom, mode)
  Cookies.set(DETAIL_SIDEBAR_COOKIE_NAME, mode, {
    expires: 365,
    path: '/',
    sameSite: 'lax',
  })
})
