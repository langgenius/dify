import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { AppInfoOperation } from './app-info-modals'
import type { Operation } from './app-operations'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { getAppACLCapabilities, hasPermission } from '@/utils/permission'
import AppInfoHeader from './app-info-header'
import { getAppModeLabel } from './app-mode-labels'

type AppInfoTriggerProps = {
  appDetail: AppDetailWithSite
  expand: boolean
  openModal: (modal: AppInfoOperation) => void
  isExporting: boolean
  exportCheck: () => void
}

const AppInfoTrigger = ({
  appDetail,
  expand,
  openModal,
  isExporting,
  exportCheck,
}: AppInfoTriggerProps) => {
  const { t } = useTranslation(['app', 'common', 'workflow'])
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const modeLabel = getAppModeLabel(appDetail.mode, t)
  const appACLCapabilities = getAppACLCapabilities(appDetail.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail.maintainer,
    workspacePermissionKeys,
  })
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')

  const mainOperations: Operation[] = [
    ...(appACLCapabilities.canEdit
      ? [
          {
            id: 'edit',
            title: t(($) => $.editApp, { ns: 'app' }),
            icon: 'i-ri-edit-line',
            onClick: () => openModal('edit'),
          },
        ]
      : []),
    ...(canCreateApp
      ? [
          {
            id: 'duplicate',
            title: t(($) => $.duplicate, { ns: 'app' }),
            icon: 'i-ri-file-copy-2-line',
            onClick: () => openModal('duplicate'),
          },
        ]
      : []),
    ...(appACLCapabilities.canImportExportDSL
      ? [
          {
            id: 'export',
            title: t(($) => $.exportApp, { ns: 'app' }),
            icon: 'i-ri-file-download-line',
            onClick: exportCheck,
            loading: isExporting,
          },
        ]
      : []),
    ...(appACLCapabilities.canImportExportDSL &&
    (appDetail.mode === 'advanced-chat' || appDetail.mode === 'workflow')
      ? [
          {
            id: 'import',
            title: t(($) => $.importApp, { ns: 'app' }),
            icon: 'i-ri-file-upload-line',
            onClick: () => openModal('importDSL'),
          },
        ]
      : []),
  ]

  const destructiveOperations: Operation[] = appACLCapabilities.canDelete
    ? [
        {
          id: 'delete',
          title: t(($) => $['operation.delete'], { ns: 'common' }),
          icon: 'i-ri-delete-bin-line',
          onClick: () => openModal('delete'),
          variant: 'destructive',
        },
      ]
    : []

  const workflowConversionOperations: Operation[] =
    appACLCapabilities.canEdit && (appDetail.mode === 'completion' || appDetail.mode === 'chat')
      ? [
          {
            id: 'switch',
            title: t(($) => $.switch, { ns: 'app' }),
            icon: 'i-ri-exchange-2-line',
            onClick: () => openModal('switch'),
          },
        ]
      : []

  return (
    <AppInfoHeader
      expand={expand}
      appName={appDetail.name}
      modeLabel={modeLabel}
      operationGroups={[mainOperations, destructiveOperations, workflowConversionOperations]}
      icon={appDetail}
    />
  )
}

export default React.memo(AppInfoTrigger)
