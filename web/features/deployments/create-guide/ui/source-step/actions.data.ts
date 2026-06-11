'use client'

import type { WorkflowSourceApp } from '../../types'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  existingInstanceNamesFromQueryData,
  sourceAppsFromQueryData,
  useExistingInstanceNamesQuery,
  useSourceAppsQuery,
} from '../../queries/source'
import {
  dslDefaultAppNameAtom,
  dslReadErrorAtom,
  dslUnsupportedModeAtom,
  hasDslContentAtom,
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

function useSourceReleaseStepReady() {
  const method = useAtomValue(methodAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const hasDslContent = useAtomValue(hasDslContentAtom)
  const dslUnsupportedMode = useAtomValue(dslUnsupportedModeAtom)
  const sourceAppsQuery = useSourceAppsQuery({
    enabled: method === 'bindApp',
    sourceSearchText,
  })
  const effectiveSelectedApp = effectiveSourceApp(selectedApp, sourceAppsFromQueryData(sourceAppsQuery.data))
  const importDslReady = method === 'importDsl'
    && hasDslContent
    && !isReadingDsl
    && !dslReadError
    && !dslUnsupportedMode
  const bindAppReady = method === 'bindApp' && Boolean(effectiveSelectedApp?.id)

  return (importDslReady || bindAppReady) && unsupportedDslNodes.length === 0
}

export function useSourceNextDisabled() {
  return !useSourceReleaseStepReady()
}

export function useSourceNextAction() {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(methodAtom)
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const setStep = useSetAtom(setStepAtom)
  const selectSourceApp = useSetAtom(selectSourceAppAtom)
  const applyReleaseDefaults = useSetAtom(applyReleaseDefaultsAtom)
  const dslDefaultAppName = useAtomValue(dslDefaultAppNameAtom)
  const sourceAppsQuery = useSourceAppsQuery({
    enabled: method === 'bindApp',
    sourceSearchText,
  })
  const appInstancesQuery = useExistingInstanceNamesQuery()
  const existingInstanceNames = existingInstanceNamesFromQueryData(appInstancesQuery.data)
  const effectiveSelectedApp = effectiveSourceApp(selectedApp, sourceAppsFromQueryData(sourceAppsQuery.data))
  const sourceName = method === 'importDsl'
    ? dslDefaultAppName || t('createGuide.dsl.defaultAppName')
    : effectiveSelectedApp?.name
  const releaseStepReady = useSourceReleaseStepReady()

  function handleNext() {
    if (!releaseStepReady)
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
