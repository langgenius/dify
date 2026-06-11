'use client'

import { atom } from 'jotai'
import { resetDeploymentTargetOptionsAtom } from './target-atoms'
import { clearCreateDeploymentGuideUnsupportedDslNodesAtom } from './unsupported-dsl-atoms'

export const dslFileAtom = atom<File | undefined>(undefined)
export const dslContentAtom = atom('')
export const isReadingDslAtom = atom(false)
export const dslReadErrorAtom = atom(false)
const dslReadTokenAtom = atom(0)

export const dslLocalAtoms = [
  dslFileAtom,
  dslContentAtom,
  isReadingDslAtom,
  dslReadErrorAtom,
  dslReadTokenAtom,
] as const

export const selectDslFileAtom = atom(null, async (get, set, dslFile?: File) => {
  // Token guard prevents a slow read from an older file from overwriting the newest selection.
  const dslReadToken = get(dslReadTokenAtom) + 1
  set(dslReadTokenAtom, dslReadToken)
  set(dslFileAtom, dslFile)
  set(dslContentAtom, '')
  set(isReadingDslAtom, Boolean(dslFile))
  set(dslReadErrorAtom, false)
  set(resetDeploymentTargetOptionsAtom)
  set(clearCreateDeploymentGuideUnsupportedDslNodesAtom)

  if (!dslFile)
    return

  try {
    const content = await dslFile.text()
    if (get(dslReadTokenAtom) !== dslReadToken)
      return

    set(dslContentAtom, content)
    set(dslReadErrorAtom, false)
  }
  catch {
    if (get(dslReadTokenAtom) !== dslReadToken)
      return

    set(dslContentAtom, '')
    set(dslReadErrorAtom, true)
  }
  finally {
    if (get(dslReadTokenAtom) === dslReadToken)
      set(isReadingDslAtom, false)
  }
})
