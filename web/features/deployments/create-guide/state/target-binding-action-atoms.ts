'use client'

import { atom } from 'jotai'
import { manualBindingSelectionsAtom } from './target-atoms'

export const selectBindingAtom = atom(null, (get, set, {
  slot,
  value,
}: {
  slot: string
  value: string
}) => {
  set(manualBindingSelectionsAtom, {
    ...get(manualBindingSelectionsAtom),
    [slot]: value,
  })
})
