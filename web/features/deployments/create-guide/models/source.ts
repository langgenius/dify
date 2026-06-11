'use client'

import { useAtomValue } from 'jotai'
import {
  dslReadErrorAtom,
  isReadingDslAtom,
} from '../state/dsl-atoms'
import { selectedAppAtom } from '../state/source-atoms'
import { methodAtom } from '../state/workflow-atoms'
import { useCreateGuideDslModel } from './dsl'

export function useSelectedSourceStatus() {
  const selectedApp = useAtomValue(selectedAppAtom)
  const method = useAtomValue(methodAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const dslModel = useCreateGuideDslModel()
  const isReady = method === 'importDsl'
    ? dslModel.hasDslContent && !isReadingDsl && !dslReadError && !dslModel.dslUnsupportedMode
    : Boolean(selectedApp?.id)

  return {
    effectiveSelectedApp: selectedApp,
    isReady,
    sourceAppToSelect: method === 'bindApp' ? selectedApp : undefined,
  }
}
