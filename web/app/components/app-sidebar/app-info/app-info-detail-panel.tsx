import type { Operation } from './app-operations'
import type { AppInfoModalType } from './use-app-info-actions'
import type { App, AppSSO } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiExchange2Line,
  RiFileCopy2Line,
  RiFileDownloadLine,
  RiFileUploadLine,
} from '@remixicon/react'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import CardView from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/card-view'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities, hasPermission } from '@/utils/permission'
import AppIcon from '../../base/app-icon'
import { AppInfoDetailDrawer } from './app-info-detail-drawer'
import { getAppModeLabel } from './app-mode-labels'
import AppOperations from './app-operations'

type AppInfoDetailPanelProps = {
  appDetail: App & Partial<AppSSO>
  show: boolean
  onClose: () => void
  openModal: (modal: Exclude<AppInfoModalType, null>) => void
  exportCheck: () => void
}

const AppInfoDetailPanel = ({
  appDetail,
  show,
  onClose,
  openModal,
  exportCheck,
}: AppInfoDetailPanelProps) => {
  const { t } = useTranslation()
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const appACLCapabilities = useMemo(() => getAppACLCapabilities(appDetail.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail.maintainer,
    workspacePermissionKeys,
  }), [appDetail.maintainer, appDetail.permission_keys, currentUserId, workspacePermissionKeys])
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')

  const primaryOperations = useMemo<Operation[]>(() => [
    ...(appACLCapabilities.canEdit
      ? [{
          id: 'edit',
          title: t($ => $.editApp, { ns: 'app' }),
          icon: <RiEditLine />,
          onClick: () => openModal('edit'),
        }]
      : []),
    ...(canCreateApp
      ? [{
          id: 'duplicate',
          title: t($ => $.duplicate, { ns: 'app' }),
          icon: <RiFileCopy2Line />,
          onClick: () => openModal('duplicate'),
        }]
      : []),
    ...(appACLCapabilities.canImportExportDSL
      ? [{
          id: 'export',
          title: t($ => $.export, { ns: 'app' }),
          icon: <RiFileDownloadLine />,
          onClick: exportCheck,
        }]
      : []),
  ], [appACLCapabilities, canCreateApp, t, openModal, exportCheck])

  const secondaryOperations = useMemo<Operation[]>(() => [
    ...(appACLCapabilities.canImportExportDSL && (appDetail.mode === AppModeEnum.ADVANCED_CHAT || appDetail.mode === AppModeEnum.WORKFLOW)
      ? [{
          id: 'import',
          title: t($ => $['common.importDSL'], { ns: 'workflow' }),
          icon: <RiFileUploadLine />,
          onClick: () => openModal('importDSL'),
        }]
      : []),
    ...(appACLCapabilities.canDelete
      ? [
          {
            id: 'divider-1',
            title: '',
            icon: <></>,
            onClick: () => {},
            type: 'divider' as const,
          },
          {
            id: 'delete',
            title: t($ => $['operation.delete'], { ns: 'common' }),
            icon: <RiDeleteBinLine />,
            onClick: () => openModal('delete'),
          },
        ]
      : []),
  ], [appACLCapabilities, appDetail.mode, t, openModal])

  const switchOperation = useMemo(() => {
    if (!appACLCapabilities.canEdit)
      return null
    if (appDetail.mode !== AppModeEnum.COMPLETION && appDetail.mode !== AppModeEnum.CHAT)
      return null
    return {
      id: 'switch',
      title: t($ => $.switch, { ns: 'app' }),
      icon: <RiExchange2Line />,
      onClick: () => openModal('switch'),
    }
  }, [appACLCapabilities.canEdit, appDetail.mode, t, openModal])

  return (
    <AppInfoDetailDrawer
      open={show}
      onClose={onClose}
    >
      <div className="flex shrink-0 flex-col items-start justify-center gap-3 self-stretch p-4">
        <div className="flex items-center gap-3 self-stretch">
          <AppIcon
            size="large"
            iconType={appDetail.icon_type}
            icon={appDetail.icon}
            background={appDetail.icon_background}
            imageUrl={appDetail.icon_url}
          />
          <div className="flex flex-1 flex-col items-start justify-center overflow-hidden">
            <h2 className="w-full truncate system-md-semibold text-text-secondary">{appDetail.name}</h2>
            <div className="system-2xs-medium-uppercase text-text-tertiary">
              {getAppModeLabel(appDetail.mode, t)}
            </div>
          </div>
        </div>
        {appDetail.description && (
          <p className="overflow-wrap-anywhere max-h-[105px] w-full max-w-full overflow-y-auto system-xs-regular wrap-break-word whitespace-normal text-text-tertiary">
            {appDetail.description}
          </p>
        )}
        <AppOperations
          gap={4}
          primaryOperations={primaryOperations}
          secondaryOperations={secondaryOperations}
        />
      </div>
      <CardView
        appId={appDetail.id}
        isInPanel={true}
        className="flex flex-1 flex-col gap-2 overflow-auto px-2 py-1"
      />
      {switchOperation && (
        <div className="flex min-h-fit shrink-0 flex-col items-start justify-center gap-3 self-stretch pb-2">
          <Button
            size="medium"
            variant="ghost"
            className="gap-0.5"
            onClick={switchOperation.onClick}
          >
            {switchOperation.icon}
            <span className="system-sm-medium text-text-tertiary">{switchOperation.title}</span>
          </Button>
        </div>
      )}
    </AppInfoDetailDrawer>
  )
}

export default React.memo(AppInfoDetailPanel)
