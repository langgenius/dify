import type { Operation } from './app-operations'
import type { AppInfoModalType } from './use-app-info-actions'
import type { App, AppSSO } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities, hasPermission } from '@/utils/permission'
import AppIcon from '../../base/app-icon'
import { getAppModeLabel } from './app-mode-labels'
import AppOperations from './app-operations'

type AppInfoTriggerProps = {
  appDetail: App & Partial<AppSSO>
  expand: boolean
  openModal: (modal: Exclude<AppInfoModalType, null>) => void
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
  const { t } = useTranslation()
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
            title: t(($) => $.export, { ns: 'app' }),
            icon: 'i-ri-file-download-line',
            onClick: exportCheck,
            loading: isExporting,
          },
        ]
      : []),
    ...(appACLCapabilities.canImportExportDSL &&
    (appDetail.mode === AppModeEnum.ADVANCED_CHAT || appDetail.mode === AppModeEnum.WORKFLOW)
      ? [
          {
            id: 'import',
            title: t(($) => $['common.importDSL'], { ns: 'workflow' }),
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
    appACLCapabilities.canEdit &&
    (appDetail.mode === AppModeEnum.COMPLETION || appDetail.mode === AppModeEnum.CHAT)
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
    <div
      className={cn(
        'rounded-xl',
        expand ? 'flex items-start gap-2 p-2' : 'flex items-center justify-center px-1 py-1.5',
      )}
    >
      <div className="flex shrink-0 items-center">
        <div>
          <AppIcon
            size={expand ? 'large' : 'medium'}
            iconType={appDetail.icon_type}
            icon={appDetail.icon}
            background={appDetail.icon_background}
            imageUrl={appDetail.icon_url}
          />
        </div>
      </div>
      {expand && (
        <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5 self-stretch">
          <div className="flex w-full min-w-0 items-center gap-2 pr-1">
            <div className="min-w-0 flex-1 truncate system-md-semibold text-text-secondary">
              {appDetail.name}
            </div>
            <AppOperations
              appName={appDetail.name}
              operationGroups={[
                mainOperations,
                destructiveOperations,
                workflowConversionOperations,
              ]}
            />
          </div>
          <div className="system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary">
            {modeLabel}
          </div>
        </div>
      )}
    </div>
  )
}

export default React.memo(AppInfoTrigger)
