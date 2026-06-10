'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  useCreateGuideExistingInstanceNames,
  useInstanceNameConflict,
} from '../queries/source'
import { submittedReleaseFieldsAtom } from '../state/release-atoms'
import {
  isCreateGuideInitialReleaseReady,
} from './guide-derived-state'
import {
  useReleaseActionSourceSnapshot,
  useReleaseStepSourceSnapshot,
} from './source'

export function useReleaseReadiness({
  existingInstanceNames,
  isSourceReady,
  shouldCheckInstanceNameConflict,
}: {
  existingInstanceNames: readonly string[]
  isSourceReady: boolean
  shouldCheckInstanceNameConflict: boolean
}) {
  const { t } = useTranslation('deployments')
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = useAtomValue(submittedReleaseFieldsAtom)
  const {
    hasInstanceNameConflict,
    isCheckingInstanceNameConflict,
  } = useInstanceNameConflict({
    existingInstanceNames,
    shouldCheck: shouldCheckInstanceNameConflict,
    submittedInstanceName,
  })
  const isInitialReleaseReady = isCreateGuideInitialReleaseReady({
    hasInstanceNameConflict: hasInstanceNameConflict || isCheckingInstanceNameConflict,
    isSourceReady,
    submittedInstanceName,
    submittedReleaseName,
  })

  return {
    hasInstanceNameConflict,
    instanceNameError: hasInstanceNameConflict ? t('createGuide.release.instanceNameConflict') : undefined,
    isCheckingInstanceNameConflict,
    isInitialReleaseReady,
    submittedInstanceName,
    submittedReleaseName,
  }
}

export function useSubmittedReleaseReadiness({
  isSourceReady,
}: {
  isSourceReady: boolean
}) {
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = useAtomValue(submittedReleaseFieldsAtom)
  const isInitialReleaseReady = isCreateGuideInitialReleaseReady({
    hasInstanceNameConflict: false,
    isSourceReady,
    submittedInstanceName,
    submittedReleaseName,
  })

  return {
    hasInstanceNameConflict: false,
    isInitialReleaseReady,
    submittedInstanceName,
    submittedReleaseName,
  }
}

export function useReleaseStepFields() {
  const source = useReleaseStepSourceSnapshot()
  const release = useReleaseReadiness({
    existingInstanceNames: source.existingInstanceNames,
    isSourceReady: source.isSourceReady,
    shouldCheckInstanceNameConflict: true,
  })

  return {
    defaultedReleaseName: source.defaultedReleaseName,
    instanceNameError: release.instanceNameError,
    sourceName: source.sourceName,
  }
}

export function useReleaseStepActionSnapshot() {
  const source = useReleaseActionSourceSnapshot()
  const { existingInstanceNames } = useCreateGuideExistingInstanceNames()
  const release = useReleaseReadiness({
    existingInstanceNames,
    isSourceReady: source.isSourceReady,
    shouldCheckInstanceNameConflict: true,
  })

  return {
    dslReadError: source.dslReadError,
    dslState: source.dslState,
    effectiveSelectedApp: source.effectiveSelectedApp,
    hasInstanceNameConflict: release.hasInstanceNameConflict,
    isReadingDsl: source.isReadingDsl,
    isInitialReleaseReady: release.isInitialReleaseReady,
    method: source.method,
  }
}
