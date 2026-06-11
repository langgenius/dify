'use client'

import { atom } from 'jotai'
import { isWorkflowDsl } from '@/features/deployments/dsl'
import {
  dslContentAtom,
  dslReadErrorAtom,
  hasDslContentAtom,
  isReadingDslAtom,
} from './dsl-atoms'
import { methodAtom } from './workflow-atoms'

export const dslUnsupportedModeAtom = atom((get) => {
  const dslContent = get(dslContentAtom)
  const hasDslContent = get(hasDslContentAtom)

  return get(methodAtom) === 'importDsl'
    && hasDslContent
    && !get(isReadingDslAtom)
    && !get(dslReadErrorAtom)
    && !isWorkflowDsl(dslContent)
})
