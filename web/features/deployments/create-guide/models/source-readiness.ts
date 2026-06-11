'use client'

import { useAtomValue } from 'jotai'
import {
  dslReadErrorAtom,
  dslUnsupportedModeAtom,
  hasDslContentAtom,
  isReadingDslAtom,
} from '../state/dsl-atoms'
import { selectedAppAtom } from '../state/source-atoms'
import { methodAtom } from '../state/workflow-atoms'

export function useCreateGuideSourceReady() {
  const selectedApp = useAtomValue(selectedAppAtom)
  const method = useAtomValue(methodAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const dslUnsupportedMode = useAtomValue(dslUnsupportedModeAtom)
  const hasDslContent = useAtomValue(hasDslContentAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)

  return method === 'importDsl'
    ? hasDslContent && !isReadingDsl && !dslReadError && !dslUnsupportedMode
    : Boolean(selectedApp?.id)
}
