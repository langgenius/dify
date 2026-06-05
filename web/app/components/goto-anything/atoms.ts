'use client'

import { atom, useAtomValue, useSetAtom } from 'jotai'

const gotoAnythingOpenAtom = atom(false)

export function useGotoAnythingOpen() {
  return useAtomValue(gotoAnythingOpenAtom)
}

export function useSetGotoAnythingOpen() {
  return useSetAtom(gotoAnythingOpenAtom)
}
