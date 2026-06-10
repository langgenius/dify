'use client'

import type { App } from '@/types/app'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { isWorkflowApp } from '@/features/deployments/app-mode'
import {
  useCreateGuideExistingInstanceNames,
  useCreateGuideSourceApps,
} from '../queries/source'
import {
  dslContentAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
} from '../state/dsl-atoms'
import { selectedAppAtom } from '../state/source-atoms'
import { methodAtom } from '../state/workflow-atoms'
import {
  isCreateGuideSourceReady,
} from './guide-derived-state'
import {
  createDslState,
  createSourceName,
} from './selectors'

function useCreateGuideDslSourceSnapshot() {
  const method = useAtomValue(methodAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const dslState = createDslState({
    dslContent,
    dslReadError,
    isReadingDsl,
    method,
  })

  return {
    dslReadError,
    dslState,
    isReadingDsl,
    method,
  }
}

function useSelectedWorkflowSourceApp() {
  const selectedApp = useAtomValue(selectedAppAtom)

  return isWorkflowApp(selectedApp) ? selectedApp : undefined
}

function createSourceReadiness({
  dslReadError,
  dslState,
  effectiveSelectedApp,
  isReadingDsl,
  method,
}: ReturnType<typeof useCreateGuideDslSourceSnapshot> & {
  effectiveSelectedApp: App | undefined
}) {
  return isCreateGuideSourceReady({
    dslReadError,
    dslUnsupportedMode: dslState.dslUnsupportedMode,
    hasDslContent: dslState.hasDslContent,
    isReadingDsl,
    method,
    selectedApp: effectiveSelectedApp,
  })
}

export function useSourceStepActionSnapshot() {
  const { t } = useTranslation('deployments')
  const dslSourceSnapshot = useCreateGuideDslSourceSnapshot()
  const sourceAppsResource = useCreateGuideSourceApps({
    enabled: dslSourceSnapshot.method === 'bindApp',
  })
  const { existingInstanceNames } = useCreateGuideExistingInstanceNames()
  const sourceName = createSourceName({
    dslFallbackAppName: t('createGuide.dsl.defaultAppName'),
    dslState: dslSourceSnapshot.dslState,
    method: dslSourceSnapshot.method,
    selectedApp: sourceAppsResource.effectiveSelectedApp,
  })
  const isSourceReady = createSourceReadiness({
    ...dslSourceSnapshot,
    effectiveSelectedApp: sourceAppsResource.effectiveSelectedApp,
  })

  return {
    defaultedReleaseName: t('createGuide.release.defaultName'),
    effectiveSelectedApp: sourceAppsResource.effectiveSelectedApp,
    existingInstanceNames,
    isSourceReady,
    method: dslSourceSnapshot.method,
    sourceName,
  }
}

export function useReleaseStepSourceSnapshot() {
  const { t } = useTranslation('deployments')
  const dslSourceSnapshot = useCreateGuideDslSourceSnapshot()
  const selectedSourceApp = useSelectedWorkflowSourceApp()
  const { existingInstanceNames } = useCreateGuideExistingInstanceNames()
  const sourceName = createSourceName({
    dslFallbackAppName: t('createGuide.dsl.defaultAppName'),
    dslState: dslSourceSnapshot.dslState,
    method: dslSourceSnapshot.method,
    selectedApp: selectedSourceApp,
  })
  const isSourceReady = createSourceReadiness({
    ...dslSourceSnapshot,
    effectiveSelectedApp: selectedSourceApp,
  })

  return {
    defaultedReleaseName: t('createGuide.release.defaultName'),
    existingInstanceNames,
    isSourceReady,
    sourceName,
  }
}

export function useReleaseActionSourceSnapshot() {
  const dslSourceSnapshot = useCreateGuideDslSourceSnapshot()
  const selectedSourceApp = useSelectedWorkflowSourceApp()
  const isSourceReady = createSourceReadiness({
    ...dslSourceSnapshot,
    effectiveSelectedApp: selectedSourceApp,
  })

  return {
    dslReadError: dslSourceSnapshot.dslReadError,
    dslState: dslSourceSnapshot.dslState,
    effectiveSelectedApp: selectedSourceApp,
    isReadingDsl: dslSourceSnapshot.isReadingDsl,
    isSourceReady,
    method: dslSourceSnapshot.method,
  }
}

export function useTargetStepSourceSnapshot() {
  const dslSourceSnapshot = useCreateGuideDslSourceSnapshot()
  const selectedSourceApp = useSelectedWorkflowSourceApp()
  const isSourceReady = createSourceReadiness({
    ...dslSourceSnapshot,
    effectiveSelectedApp: selectedSourceApp,
  })

  return {
    effectiveSelectedApp: selectedSourceApp,
    isSourceReady,
  }
}
