'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  existingInstanceNamesFromQueryData,
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
import { applyReleaseDefaultsAtom } from '../../state/release-atoms'
import {
  selectedAppAtom,
  selectSourceAppAtom,
  sourceSearchTextAtom,
} from '../../state/source-atoms'
import { unsupportedDslNodesAtom } from '../../state/unsupported-dsl-atoms'
import {
  methodAtom,
  setStepAtom,
} from '../../state/workflow-atoms'

export function SourceActionButtons() {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(methodAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const dslUnsupportedMode = useAtomValue(dslUnsupportedModeAtom)
  const hasDslContent = useAtomValue(hasDslContentAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const sourceSearchText = useAtomValue(sourceSearchTextAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
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
  const sourceApps = sourceAppsQuery.data?.pages.flatMap(page => page.data) ?? []
  const effectiveSelectedApp = selectedApp ?? sourceApps[0]
  const importDslReady = method === 'importDsl'
    && hasDslContent
    && !isReadingDsl
    && !dslReadError
    && !dslUnsupportedMode
  const bindAppReady = method === 'bindApp' && Boolean(effectiveSelectedApp?.id)
  const canGoNext = (importDslReady || bindAppReady) && unsupportedDslNodes.length === 0
  const sourceName = method === 'importDsl'
    ? dslDefaultAppName || t('createGuide.dsl.defaultAppName')
    : effectiveSelectedApp?.name

  function handleNext() {
    if (!canGoNext)
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

  return (
    <Button type="button" variant="primary" disabled={!canGoNext} onClick={handleNext}>
      {t('createGuide.actions.next')}
    </Button>
  )
}
