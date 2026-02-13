import { RiEqualizer2Line } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CardView from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/card-view'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import ContentDialog from '@/app/components/base/content-dialog'
import { useAppContext } from '@/context/app-context'
import { cn } from '@/utils/classnames'
import AppInfoModals from './components/app-info-modals'
import AppOperations from './components/app-operations'
import { getAppModeI18nKey, useAppInfoActions } from './hooks/use-app-info-actions'

export type IAppInfoProps = {
  expand: boolean
  onlyShowDetail?: boolean
  openState?: boolean
  onDetailExpand?: (expand: boolean) => void
}

const AppInfo = ({ expand, onlyShowDetail = false, openState = false, onDetailExpand }: IAppInfoProps) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const [open, setOpen] = useState(openState)

  const closePanel = useCallback(() => {
    setOpen(false)
    onDetailExpand?.(false)
  }, [onDetailExpand])

  const {
    appDetail,
    activeModal,
    showExportWarning,
    secretEnvList,
    closeModal,
    closeExportWarning,
    clearSecretEnvList,
    onEdit,
    onCopy,
    onExport,
    exportCheck,
    handleConfirmExport,
    onConfirmDelete,
    primaryOperations,
    secondaryOperations,
    switchOperation,
  } = useAppInfoActions({ closePanel })

  if (!appDetail)
    return null

  const modeLabel = t(getAppModeI18nKey(appDetail.mode), { ns: 'app' })

  return (
    <div>
      {!onlyShowDetail && (
        <button
          type="button"
          onClick={() => {
            if (isCurrentWorkspaceEditor)
              setOpen(v => !v)
          }}
          className="block w-full"
        >
          <div className="flex flex-col gap-2 rounded-lg p-1 hover:bg-state-base-hover">
            <div className="flex items-center gap-1">
              <div className={cn(!expand && 'ml-1')}>
                <AppIcon
                  size={expand ? 'large' : 'small'}
                  iconType={appDetail.icon_type}
                  icon={appDetail.icon}
                  background={appDetail.icon_background}
                  imageUrl={appDetail.icon_url}
                />
              </div>
              {expand && (
                <div className="ml-auto flex items-center justify-center rounded-md p-0.5">
                  <div className="flex h-5 w-5 items-center justify-center">
                    <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
                  </div>
                </div>
              )}
            </div>
            {!expand && (
              <div className="flex items-center justify-center">
                <div className="flex h-5 w-5 items-center justify-center rounded-md p-0.5">
                  <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
                </div>
              </div>
            )}
            {expand && (
              <div className="flex flex-col items-start gap-1">
                <div className="flex w-full">
                  <div className="truncate whitespace-nowrap text-text-secondary system-md-semibold">{appDetail.name}</div>
                </div>
                <div className="whitespace-nowrap text-text-tertiary system-2xs-medium-uppercase">
                  {modeLabel}
                </div>
              </div>
            )}
          </div>
        </button>
      )}
      <ContentDialog
        show={onlyShowDetail ? openState : open}
        onClose={closePanel}
        className="absolute bottom-2 left-2 top-2 flex w-[420px] flex-col rounded-2xl !p-0"
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
              <div className="w-full truncate text-text-secondary system-md-semibold">{appDetail.name}</div>
              <div className="text-text-tertiary system-2xs-medium-uppercase">{modeLabel}</div>
            </div>
          </div>
          {appDetail.description && (
            <div className="overflow-wrap-anywhere max-h-[105px] w-full max-w-full overflow-y-auto whitespace-normal break-words text-text-tertiary system-xs-regular">{appDetail.description}</div>
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
              <span className="text-text-tertiary system-sm-medium">{switchOperation.title}</span>
            </Button>
          </div>
        )}
      </ContentDialog>
      <AppInfoModals
        appDetail={appDetail}
        activeModal={activeModal}
        showExportWarning={showExportWarning}
        secretEnvList={secretEnvList}
        onCloseModal={closeModal}
        onCloseExportWarning={closeExportWarning}
        onEdit={onEdit}
        onCopy={onCopy}
        onExport={onExport}
        onConfirmDelete={onConfirmDelete}
        onConfirmExport={handleConfirmExport}
        onExportCheck={exportCheck}
        onClearSecretEnvList={clearSecretEnvList}
      />
    </div>
  )
}

export default React.memo(AppInfo)
