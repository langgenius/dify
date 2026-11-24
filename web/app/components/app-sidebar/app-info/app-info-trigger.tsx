import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { AppInfoDialogHandles } from './app-info-dialog-handles'
import type { Operation } from './app-operations'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useExportAppDsl } from '@/app/components/app/use-export-app-dsl'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { getAppACLCapabilities, hasPermission } from '@/utils/permission'
import { AppInfoHeader } from './app-info-header'
import { getAppModeLabel } from './app-mode-labels'

type AppInfoTriggerProps = {
  appDetail: AppDetailWithSite
  expand: boolean
  handles: AppInfoDialogHandles
}

export function AppInfoTrigger({ appDetail, expand, handles }: AppInfoTriggerProps) {
  const { t } = useTranslation(['app', 'common', 'workflow'])
  const { exportAppDsl, isExporting } = useExportAppDsl()
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const modeLabel = getAppModeLabel(appDetail.mode, t, appDetail.workflow_kind)
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
            onClick: () => handles.edit.open(null),
          },
        ]
      : []),
    ...(canCreateApp
      ? [
          {
            id: 'duplicate',
            title: t(($) => $.duplicate, { ns: 'app' }),
            icon: 'i-ri-file-copy-2-line',
            onClick: () => handles.duplicate.open(null),
          },
        ]
      : []),
    ...(appACLCapabilities.canImportExportDSL
      ? [
          {
            id: 'export',
            title: t(($) => $.exportApp, { ns: 'app' }),
            icon: 'i-ri-file-download-line',
            onClick: () => {
              if (appDetail.mode === 'workflow' || appDetail.mode === 'advanced-chat')
                handles.export.openWithPayload(null)
              else void exportAppDsl({ appId: appDetail.id, appName: appDetail.name })
            },
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
            onClick: () => handles.importDSL.open(null),
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
          onClick: () => handles.delete.open(null),
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
            onClick: () => handles.switchApp.open(null),
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
