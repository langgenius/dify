'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  createDslState,
} from '../../models/dsl'
import {
  hasReleaseInstanceNameConflict,
} from '../../models/release'
import {
  createSelectedWorkflowSourceApp,
  createSourceStatus,
} from '../../models/source'
import {
  existingInstanceNamesFromQueryData,
  instanceNameConflictFromQueryData,
  useExistingInstanceNamesQuery,
  useInstanceNameConflictQuery,
} from '../../queries/source'
import {
  dslContentAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
} from '../../state/dsl-atoms'
import {
  submittedReleaseFieldsAtom,
} from '../../state/release-atoms'
import {
  selectedAppAtom,
} from '../../state/source-atoms'
import {
  methodAtom,
} from '../../state/workflow-atoms'

export function useReleaseInstanceNameFieldData() {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(methodAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const appInstancesQuery = useExistingInstanceNamesQuery()
  const existingInstanceNames = existingInstanceNamesFromQueryData(appInstancesQuery.data)
  const {
    submittedInstanceName,
  } = useAtomValue(submittedReleaseFieldsAtom)
  const instanceNameConflictQuery = useInstanceNameConflictQuery({
    enabled: Boolean(submittedInstanceName),
    submittedInstanceName,
  })
  const dslState = createDslState({
    dslContent,
    dslReadError,
    isReadingDsl,
    method,
  })
  const effectiveSelectedApp = createSelectedWorkflowSourceApp(selectedApp)
  const source = createSourceStatus({
    dslFallbackAppName: t('createGuide.dsl.defaultAppName'),
    dslReadError,
    dslState,
    effectiveSelectedApp,
    isReadingDsl,
    method,
  })
  const remoteInstanceNameConflict = instanceNameConflictFromQueryData(instanceNameConflictQuery.data, submittedInstanceName)
  const hasInstanceNameConflict = hasReleaseInstanceNameConflict({
    existingInstanceNames,
    remoteInstanceNameConflict,
    submittedInstanceName,
  })

  return {
    instanceNameError: hasInstanceNameConflict ? t('createGuide.release.instanceNameConflict') : undefined,
    sourceName: source.sourceName,
  }
}
