import type { AppInfoActions } from './use-app-info-actions'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { getAppACLCapabilities } from '@/utils/permission'
import AppInfoDetailPanel from './app-info-detail-panel'
import AppInfoModals from './app-info-modals'
import AppInfoTrigger from './app-info-trigger'

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
  const {
    appDetail,
    panelOpen,
    setPanelOpen,
    activeModal,
    secretEnvList,
  } = actions
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const appACLCapabilities = getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
  })

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
            if (appACLCapabilities.canAccessLayout)
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
