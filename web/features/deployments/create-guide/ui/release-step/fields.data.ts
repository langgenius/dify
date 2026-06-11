'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { isWorkflowApp } from '@/features/deployments/app-mode'
import { useCreateGuideDslModel } from '../../models/dsl'
import { useSubmittedReleaseFieldsStatus } from '../../models/release'
import { selectedAppAtom } from '../../state/source-atoms'
import { methodAtom } from '../../state/workflow-atoms'

export function useReleaseInstanceNamePlaceholder() {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(methodAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const dslModel = useCreateGuideDslModel()

  return method === 'importDsl'
    ? dslModel.dslDefaultAppName || t('createGuide.dsl.defaultAppName')
    : isWorkflowApp(selectedApp) ? selectedApp.name : undefined
}

export function useReleaseInstanceNameError() {
  const { t } = useTranslation('deployments')
  const { hasInstanceNameConflict } = useSubmittedReleaseFieldsStatus()

  return hasInstanceNameConflict ? t('createGuide.release.instanceNameConflict') : undefined
}
