'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useReleaseInstanceNameConflictQuery } from '../../models/release'
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
  const { hasInstanceNameConflict } = useReleaseInstanceNameConflictQuery()

  return hasInstanceNameConflict ? t('createGuide.release.instanceNameConflict') : undefined
}
