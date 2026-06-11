'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  existingInstanceNamesFromQueryData,
  instanceNameConflictFromQueryData,
  useExistingInstanceNamesQuery,
  useInstanceNameConflictQuery,
} from '../../queries/source'
import {
  dslReadErrorAtom,
  dslUnsupportedModeAtom,
  hasDslContentAtom,
  isReadingDslAtom,
} from '../../state/dsl-atoms'
import { submittedReleaseFieldsAtom } from '../../state/release-atoms'
import { selectedAppAtom } from '../../state/source-atoms'
import { resetDeploymentTargetOptionsAtom } from '../../state/target-atoms'
import {
  unsupportedDslNodesAtom,
} from '../../state/unsupported-dsl-atoms'
import {
  methodAtom,
  setStepAtom,
} from '../../state/workflow-atoms'

export function ReleaseActionButtons() {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(methodAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const dslUnsupportedMode = useAtomValue(dslUnsupportedModeAtom)
  const hasDslContent = useAtomValue(hasDslContentAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const {
    submittedInstanceName,
    submittedReleaseName,
  } = useAtomValue(submittedReleaseFieldsAtom)
  const appInstancesQuery = useExistingInstanceNamesQuery()
  const existingInstanceNames = existingInstanceNamesFromQueryData(appInstancesQuery.data)
  const instanceNameConflictQuery = useInstanceNameConflictQuery({
    enabled: Boolean(submittedInstanceName),
    submittedInstanceName,
  })
  const remoteInstanceNameConflict = instanceNameConflictFromQueryData(instanceNameConflictQuery.data, submittedInstanceName)
  const hasInstanceNameConflict = Boolean(
    submittedInstanceName
    && (
      existingInstanceNames.includes(submittedInstanceName)
      || remoteInstanceNameConflict
    ),
  )
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const sourceReady = method === 'importDsl'
    ? hasDslContent && !isReadingDsl && !dslReadError && !dslUnsupportedMode
    : Boolean(selectedApp?.id)
  const canGoNext = sourceReady
    && Boolean(submittedInstanceName)
    && Boolean(submittedReleaseName)
    && !hasInstanceNameConflict
    && !(Boolean(submittedInstanceName) && instanceNameConflictQuery.isLoading)
    && unsupportedDslNodes.length === 0
  const setStep = useSetAtom(setStepAtom)
  const resetTargetOptions = useSetAtom(resetDeploymentTargetOptionsAtom)

  function handleNext() {
    if (!canGoNext)
      return

    resetTargetOptions()
    setStep('target')
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setStep('source')}>
        {t('createGuide.actions.back')}
      </Button>
      <Button type="button" variant="primary" disabled={!canGoNext} onClick={handleNext}>
        {t('createGuide.actions.next')}
      </Button>
    </>
  )
}
