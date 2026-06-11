'use client'

import { atom } from 'jotai'
import {
  dslReadErrorAtom,
  hasDslContentAtom,
  isReadingDslAtom,
} from './dsl-atoms'
import { dslUnsupportedModeAtom } from './dsl-derived-atoms'
import { sourceAppsAtom } from './query-atoms'
import { selectedAppAtom } from './source-atoms'
import { unsupportedDslNodesAtom } from './unsupported-dsl-derived-atoms'
import { methodAtom } from './workflow-atoms'

export const effectiveSelectedAppAtom = atom((get) => {
  return get(selectedAppAtom) ?? get(sourceAppsAtom)[0]
})

export const sourceCanGoNextAtom = atom((get) => {
  const method = get(methodAtom)
  const importDslReady = method === 'importDsl'
    && get(hasDslContentAtom)
    && !get(isReadingDslAtom)
    && !get(dslReadErrorAtom)
    && !get(dslUnsupportedModeAtom)
  const bindAppReady = method === 'bindApp' && Boolean(get(effectiveSelectedAppAtom)?.id)

  return (importDslReady || bindAppReady) && get(unsupportedDslNodesAtom).length === 0
})
