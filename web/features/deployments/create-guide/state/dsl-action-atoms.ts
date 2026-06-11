'use client'

import { atom } from 'jotai'
import {
  dslContentAtom,
  dslFileAtom,
  dslReadErrorAtom,
  dslReadTokenAtom,
  isReadingDslAtom,
} from './dsl-atoms'
import { resetDeploymentTargetOptionsAtom } from './target-atoms'
import { submissionUnsupportedDslNodesAtom } from './unsupported-dsl-atoms'

export const selectDslFileAtom = atom(null, async (get, set, dslFile?: File) => {
  set(resetDeploymentTargetOptionsAtom)
  set(submissionUnsupportedDslNodesAtom, [])

  // Token guard prevents a slow read from an older file from overwriting the newest selection.
  const dslReadToken = get(dslReadTokenAtom) + 1
  set(dslReadTokenAtom, dslReadToken)
  set(dslFileAtom, dslFile)
  set(dslContentAtom, '')
  set(isReadingDslAtom, Boolean(dslFile))
  set(dslReadErrorAtom, false)

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
