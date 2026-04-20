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
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import CardView from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/card-view'
import ContentDialog from '@/app/components/base/content-dialog'
import { AppModeEnum } from '@/types/app'
import AppIcon from '../../base/app-icon'
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

  const primaryOperations = useMemo<Operation[]>(() => [
    {
      id: 'edit',
      title: t('editApp', { ns: 'app' }),
      icon: <RiEditLine />,
      onClick: () => openModal('edit'),
    },
    {
      id: 'duplicate',
      title: t('duplicate', { ns: 'app' }),
      icon: <RiFileCopy2Line />,
      onClick: () => openModal('duplicate'),
    },
    {
      id: 'export',
      title: t('export', { ns: 'app' }),
      icon: <RiFileDownloadLine />,
      onClick: exportCheck,
    },
  ], [t, openModal, exportCheck])

  const secondaryOperations = useMemo<Operation[]>(() => [
    ...(appDetail.mode === AppModeEnum.ADVANCED_CHAT || appDetail.mode === AppModeEnum.WORKFLOW)
      ? [{
          id: 'import',
          title: t('common.importDSL', { ns: 'workflow' }),
          icon: <RiFileUploadLine />,
          onClick: () => openModal('importDSL'),
        }]
      : [],
    {
      id: 'divider-1',
      title: '',
      icon: <></>,
      onClick: () => {},
      type: 'divider' as const,
    },
    {
      id: 'delete',
      title: t('operation.delete', { ns: 'common' }),
      icon: <RiDeleteBinLine />,
      onClick: () => openModal('delete'),
    },
  ], [appDetail.mode, t, openModal])

  const switchOperation = useMemo(() => {
    if (appDetail.mode !== AppModeEnum.COMPLETION && appDetail.mode !== AppModeEnum.CHAT)
      return null
    return {
      id: 'switch',
      title: t('switch', { ns: 'app' }),
      icon: <RiExchange2Line />,
      onClick: () => openModal('switch'),
    }
  }, [appDetail.mode, t, openModal])

  return (
    <ContentDialog
      show={show}
      onClose={onClose}
      className="absolute top-2 bottom-2 left-2 flex w-[452px] max-w-[calc(100vw-1rem)] flex-col rounded-2xl p-0!"
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
            <div className="w-full truncate system-md-semibold text-text-secondary">{appDetail.name}</div>
            <div className="system-2xs-medium-uppercase text-text-tertiary">
              {getAppModeLabel(appDetail.mode, t)}
            </div>
          </div>
        </div>
        {appDetail.description && (
          <div className="overflow-wrap-anywhere max-h-[105px] w-full max-w-full overflow-y-auto system-xs-regular wrap-break-word whitespace-normal text-text-tertiary">
            {appDetail.description}
          </div>
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
    </ContentDialog>
  )
}

export default React.memo(AppInfoDetailPanel)
