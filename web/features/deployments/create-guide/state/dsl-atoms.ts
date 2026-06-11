'use client'

import { atom } from 'jotai'
import {
  dslAppName,
  encodeDslContent,
} from '@/features/deployments/dsl'

export const dslFileAtom = atom<File | undefined>(undefined)
export const dslContentAtom = atom('')
export const isReadingDslAtom = atom(false)
export const dslReadErrorAtom = atom(false)
export const dslReadTokenAtom = atom(0)

export const hasDslContentAtom = atom(get => Boolean(get(dslContentAtom).trim()))

export const dslDefaultAppNameAtom = atom((get) => {
  const dslContent = get(dslContentAtom)

  return dslContent ? dslAppName(dslContent) : ''
})

export const encodedDslContentAtom = atom((get) => {
  const dslContent = get(dslContentAtom)

  return get(hasDslContentAtom) ? encodeDslContent(dslContent) : ''
})
