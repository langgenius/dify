'use client'

import type { SetStateAction } from 'jotai'
import type { DetailSidebarMode } from './preference'
import { atom } from 'jotai'
import Cookies from 'js-cookie'
import { DEFAULT_DETAIL_SIDEBAR_MODE, DETAIL_SIDEBAR_COOKIE_NAME } from './preference'

const detailSidebarModeBaseAtom = atom(DEFAULT_DETAIL_SIDEBAR_MODE)

function persistDetailSidebarMode(mode: DetailSidebarMode) {
  try {
    Cookies.set(DETAIL_SIDEBAR_COOKIE_NAME, mode, {
      expires: 365,
      path: '/',
      sameSite: 'lax',
      secure: globalThis.location.protocol === 'https:',
    })
  } catch {
    // Cookie persistence is best-effort; Jotai remains the runtime source of truth.
  }
}

export const detailSidebarModeAtom = atom(
  (get) => get(detailSidebarModeBaseAtom),
  (get, set, update: SetStateAction<DetailSidebarMode>) => {
    const nextMode = typeof update === 'function' ? update(get(detailSidebarModeBaseAtom)) : update

    set(detailSidebarModeBaseAtom, nextMode)
    persistDetailSidebarMode(nextMode)
  },
)

export const initializeDetailSidebarModeAtom = atom(null, (_get, set, mode: DetailSidebarMode) => {
  set(detailSidebarModeBaseAtom, mode)
})
