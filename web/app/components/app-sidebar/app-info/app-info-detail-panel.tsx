import type { Operation } from './app-operations'
import type { AppInfoModalType } from './use-app-info-actions'
import type { App, AppSSO } from '@/types/app'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import CardView from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/card-view'
import Button from '@/app/components/base/button'
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
} from '@/app/components/base/ui/dialog'
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

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open)
      onClose()
  }, [onClose])

  const primaryOperations = useMemo<Operation[]>(() => [
    {
      id: 'edit',
      title: t('editApp', { ns: 'app' }),
      icon: <span className="i-ri-edit-line size-4" />,
      onClick: () => openModal('edit'),
    },
    {
      id: 'duplicate',
      title: t('duplicate', { ns: 'app' }),
      icon: <span className="i-ri-file-copy-2-line size-4" />,
      onClick: () => openModal('duplicate'),
    },
    {
      id: 'export',
      title: t('export', { ns: 'app' }),
      icon: <span className="i-ri-file-download-line size-4" />,
      onClick: exportCheck,
    },
  ], [t, openModal, exportCheck])

  const secondaryOperations = useMemo<Operation[]>(() => [
    ...(appDetail.mode === AppModeEnum.ADVANCED_CHAT || appDetail.mode === AppModeEnum.WORKFLOW)
      ? [{
          id: 'import',
          title: t('common.importDSL', { ns: 'workflow' }),
          icon: <span className="i-ri-file-upload-line size-4" />,
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
      icon: <span className="i-ri-delete-bin-line size-4" />,
      onClick: () => openModal('delete'),
    },
  ], [appDetail.mode, t, openModal])

  const switchOperation = useMemo(() => {
    if (appDetail.mode !== AppModeEnum.COMPLETION && appDetail.mode !== AppModeEnum.CHAT)
      return null
    return {
      id: 'switch',
      title: t('switch', { ns: 'app' }),
      icon: <span className="i-ri-exchange-2-line size-4" />,
      onClick: () => openModal('switch'),
    }
  }, [appDetail.mode, t, openModal])

  return (
    <Dialog open={show} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogBackdrop className="duration-300" />
        <DialogPopup className="inset-y-0 left-0 m-2 flex w-[420px] flex-col rounded-2xl border-r border-divider-burn bg-app-detail-bg transition-transform duration-300 ease-out data-ending-style:-translate-x-[calc(100%+theme(spacing.2))] data-starting-style:-translate-x-[calc(100%+theme(spacing.2))] motion-reduce:transition-none">
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
              <div className="max-h-[105px] w-full max-w-full overflow-y-auto system-xs-regular wrap-anywhere text-text-tertiary">
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
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}

export default React.memo(AppInfoDetailPanel)
