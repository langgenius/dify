'use client'

import { atom } from 'jotai'
import {
  dslReadErrorAtom,
  dslUnsupportedModeAtom,
  hasDslContentAtom,
  isReadingDslAtom,
} from './dsl-atoms'
import { selectedAppAtom } from './source-atoms'
import { methodAtom } from './workflow-atoms'

export const deploymentTargetQueryEnabledAtom = atom((get) => {
  const method = get(methodAtom)

  return (method === 'bindApp' && Boolean(get(selectedAppAtom)?.id))
    || (
      method === 'importDsl'
      && get(hasDslContentAtom)
      && !get(isReadingDslAtom)
      && !get(dslReadErrorAtom)
      && !get(dslUnsupportedModeAtom)
    )
})

export const deploymentTargetQueryLocalAtoms = [
  deploymentTargetQueryEnabledAtom,
] as const
