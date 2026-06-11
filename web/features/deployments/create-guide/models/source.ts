'use client'

import type { App } from '@/types/app'
import { useAtomValue } from 'jotai'
import { isWorkflowApp } from '@/features/deployments/app-mode'
import {
  dslReadErrorAtom,
  isReadingDslAtom,
} from '../state/dsl-atoms'
import { selectedAppAtom } from '../state/source-atoms'
import { methodAtom } from '../state/workflow-atoms'
import { useCreateGuideDslModel } from './dsl'

function selectedWorkflowSourceApp(selectedApp: App | undefined) {
  return isWorkflowApp(selectedApp) ? selectedApp : undefined
}

export function useSelectedSourceStatus() {
  const selectedApp = useAtomValue(selectedAppAtom)
  const method = useAtomValue(methodAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const dslModel = useCreateGuideDslModel()
  const effectiveSelectedApp = selectedWorkflowSourceApp(selectedApp)
  const isReady = method === 'importDsl'
    ? dslModel.hasDslContent && !isReadingDsl && !dslReadError && !dslModel.dslUnsupportedMode
    : Boolean(effectiveSelectedApp?.id)

  return {
    effectiveSelectedApp,
    isReady,
    sourceAppToSelect: method === 'bindApp' ? effectiveSelectedApp : undefined,
  }
}
