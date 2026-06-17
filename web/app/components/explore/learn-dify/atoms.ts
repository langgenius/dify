'use client'

import { atom, useAtomValue, useSetAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export const LEARN_DIFY_HIDDEN_STORAGE_KEY = 'explore-learn-dify-hidden'

const learnDifyHiddenAtom = atomWithStorage<boolean>(
  LEARN_DIFY_HIDDEN_STORAGE_KEY,
  false,
  undefined,
  { getOnInit: true },
)

const learnDifyVisibleAtom = atom(get => !get(learnDifyHiddenAtom))

export function useLearnDifyVisibleValue() {
  return useAtomValue(learnDifyVisibleAtom)
}

export function useSetLearnDifyHidden() {
  return useSetAtom(learnDifyHiddenAtom)
}
