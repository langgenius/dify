'use client'

import type { WorkflowSourceApp } from '../../types'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  useCreateGuideDslModel,
} from '../../models/dsl'
import {
  existingInstanceNamesFromQueryData,
  sourceAppsFromQueryData,
  useExistingInstanceNamesQuery,
  useSourceAppsQuery,
} from '../../queries/source'
import {
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

function effectiveSourceApp(selectedApp: WorkflowSourceApp | undefined, sourceApps: ReturnType<typeof sourceAppsFromQueryData>) {
  return selectedApp ?? sourceApps[0]
}

export function useSourceCanEnterReleaseStep() {
  const method = useAtomValue(methodAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const sourceAppsQuery = useSourceAppsQuery({
    enabled: method === 'bindApp',
    sourceSearchText,
  })
  const dslModel = useCreateGuideDslModel()
  const effectiveSelectedApp = effectiveSourceApp(selectedApp, sourceAppsFromQueryData(sourceAppsQuery.data))
  const importDslReady = method === 'importDsl'
    && dslModel.hasDslContent
    && !isReadingDsl
    && !dslReadError
    && !dslModel.dslUnsupportedMode
  const bindAppReady = method === 'bindApp' && Boolean(effectiveSelectedApp?.id)

  return (importDslReady || bindAppReady) && unsupportedDslNodes.length === 0
}

export function useSourceNextAction(canEnterReleaseStep: boolean) {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(methodAtom)
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const setStep = useSetAtom(setStepAtom)
  const selectSourceApp = useSetAtom(selectSourceAppAtom)
  const applyReleaseDefaults = useSetAtom(applyReleaseDefaultsAtom)
  const sourceAppsQuery = useSourceAppsQuery({
    enabled: method === 'bindApp',
    sourceSearchText,
  })
  const appInstancesQuery = useExistingInstanceNamesQuery()
  const existingInstanceNames = existingInstanceNamesFromQueryData(appInstancesQuery.data)
  const dslModel = useCreateGuideDslModel()
  const effectiveSelectedApp = effectiveSourceApp(selectedApp, sourceAppsFromQueryData(sourceAppsQuery.data))
  const sourceName = method === 'importDsl'
    ? dslModel.dslDefaultAppName || t('createGuide.dsl.defaultAppName')
    : effectiveSelectedApp?.name

  function handleNext() {
    if (!canEnterReleaseStep)
      return

    if (method === 'bindApp' && effectiveSelectedApp)
      selectSourceApp(effectiveSelectedApp)

    applyReleaseDefaults({
      defaultReleaseName: t('createGuide.release.defaultName'),
      existingNames: existingInstanceNames,
      sourceName,
    })
    setStep('release')
  }

  return handleNext
}
