import type { AppInfoActions } from './use-app-info-actions'
import * as React from 'react'
import { useAppContext } from '@/context/app-context'
import AppInfoDetailPanel from './app-info-detail-panel'
import AppInfoModals from './app-info-modals'
import AppInfoTrigger from './app-info-trigger'
import { useAppInfoActions } from './use-app-info-actions'

type IAppInfoProps = {
  expand: boolean
  onlyShowDetail?: boolean
  openState?: boolean
  onDetailExpand?: (expand: boolean) => void
}

type AppInfoViewProps = Omit<IAppInfoProps, 'onDetailExpand'> & {
  actions: AppInfoActions
  renderDetail?: boolean
}

type AppInfoDetailLayerProps = {
  actions: AppInfoActions
  open?: boolean
}

const AppInfoDetailLayer = ({
  actions,
  open = actions.panelOpen,
}: AppInfoDetailLayerProps) => {
  const {
    appDetail,
    closePanel,
    activeModal,
    openModal,
    closeModal,
    secretEnvList,
    setSecretEnvList,
    onEdit,
    onCopy,
    onExport,
    exportCheck,
    handleConfirmExport,
    onConfirmDelete,
  } = actions

  if (!appDetail)
    return null

  return (
    <>
      <AppInfoDetailPanel
        appDetail={appDetail}
        show={open}
        onClose={closePanel}
        openModal={openModal}
        exportCheck={exportCheck}
      />
      <AppInfoModals
        appDetail={appDetail}
        activeModal={activeModal}
        closeModal={closeModal}
        secretEnvList={secretEnvList}
        setSecretEnvList={setSecretEnvList}
        onEdit={onEdit}
        onCopy={onCopy}
        onExport={onExport}
        exportCheck={exportCheck}
        handleConfirmExport={handleConfirmExport}
        onConfirmDelete={onConfirmDelete}
      />
    </>
  )
}

export const AppInfoView = ({
  expand,
  onlyShowDetail = false,
  openState = false,
  actions,
  renderDetail = true,
}: AppInfoViewProps) => {
  const { isCurrentWorkspaceEditor } = useAppContext()
  const {
    appDetail,
    panelOpen,
    setPanelOpen,
    activeModal,
    secretEnvList,
  } = actions

  if (!appDetail)
    return null

  const detailLayerOpen = onlyShowDetail ? openState : panelOpen
  const shouldRenderDetailLayer = renderDetail && (detailLayerOpen || activeModal || secretEnvList.length > 0)

  return (
    <div>
      {!onlyShowDetail && (
        <AppInfoTrigger
          appDetail={appDetail}
          expand={expand}
          onClick={() => {
            if (isCurrentWorkspaceEditor)
              setPanelOpen(v => !v)
          }}
        />
      )}
      {shouldRenderDetailLayer && (
        <AppInfoDetailLayer
          actions={actions}
          open={detailLayerOpen}
        />
      )}
    </div>
  )
}

const AppInfo = ({ onDetailExpand, ...props }: IAppInfoProps) => {
  const actions = useAppInfoActions({ onDetailExpand })

  return (
    <AppInfoView
      {...props}
      actions={actions}
    />
  )
}

export default React.memo(AppInfo)
