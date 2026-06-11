'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useReleaseInstanceNameConflict } from '../../models/release'
import { dslDefaultAppNameAtom } from '../../state/dsl-atoms'
import { selectedAppAtom } from '../../state/source-atoms'
import { methodAtom } from '../../state/workflow-atoms'

export function useReleaseInstanceNamePlaceholder() {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(methodAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const dslDefaultAppName = useAtomValue(dslDefaultAppNameAtom)

  return method === 'importDsl'
    ? dslDefaultAppName || t('createGuide.dsl.defaultAppName')
    : selectedApp?.name
}

export function useReleaseInstanceNameError() {
  const { t } = useTranslation('deployments')
  const hasInstanceNameConflict = useReleaseInstanceNameConflict()

  return hasInstanceNameConflict ? t('createGuide.release.instanceNameConflict') : undefined
}
