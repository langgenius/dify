'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  createDslState,
} from '../../models/dsl'
import {
  createEffectiveSelectedApp,
  createSourceStatus,
} from '../../models/source'
import {
  existingInstanceNamesFromQueryData,
  sourceAppsFromQueryData,
  useExistingInstanceNamesQuery,
  useSourceAppsQuery,
} from '../../queries/source'
import {
  dslContentAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
} from '../../state/dsl-atoms'
import {
  applyReleaseDefaultsAtom,
} from '../../state/release-atoms'
import {
  selectedAppAtom,
  selectSourceAppAtom,
  sourceSearchTextAtom,
} from '../../state/source-atoms'
import {
  unsupportedDslNodesAtom,
} from '../../state/unsupported-dsl-atoms'
import {
  methodAtom,
  setStepAtom,
} from '../../state/workflow-atoms'

export function useSourceAction() {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(methodAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const setStep = useSetAtom(setStepAtom)
  const selectSourceApp = useSetAtom(selectSourceAppAtom)
  const applyReleaseDefaults = useSetAtom(applyReleaseDefaultsAtom)
  const sourceAppsQuery = useSourceAppsQuery({
    enabled: method === 'bindApp',
    sourceSearchText,
  })
  const appInstancesQuery = useExistingInstanceNamesQuery()
  const existingInstanceNames = existingInstanceNamesFromQueryData(appInstancesQuery.data)
  const dslState = createDslState({
    dslContent,
    dslReadError,
    isReadingDsl,
    method,
  })
  const effectiveSelectedApp = createEffectiveSelectedApp(selectedApp, sourceAppsFromQueryData(sourceAppsQuery.data))
  const source = createSourceStatus({
    dslFallbackAppName: t('createGuide.dsl.defaultAppName'),
    dslReadError,
    dslState,
    effectiveSelectedApp,
    isReadingDsl,
    method,
  })
  const canGoNext = source.isSourceReady && unsupportedDslNodes.length === 0

  function handleNext() {
    if (!canGoNext)
      return

    if (method === 'bindApp' && source.effectiveSelectedApp)
      selectSourceApp(source.effectiveSelectedApp)

    applyReleaseDefaults({
      defaultReleaseName: t('createGuide.release.defaultName'),
      existingNames: existingInstanceNames,
      sourceName: source.sourceName,
    })
    setStep('release')
  }

  return {
    canGoNext,
    handleNext,
  }
}
