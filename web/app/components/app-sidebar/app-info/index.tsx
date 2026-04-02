import * as React from 'react'
import { useAppContext } from '@/context/app-context'
import AppInfoDetailPanel from './app-info-detail-panel'
import AppInfoModals from './app-info-modals'
import AppInfoTrigger from './app-info-trigger'
import { useAppInfoActions } from './use-app-info-actions'

export type IAppInfoProps = {
  expand: boolean
  onlyShowDetail?: boolean
  openState?: boolean
  onDetailExpand?: (expand: boolean) => void
}

const AppInfo = ({ expand, onlyShowDetail = false, openState = false, onDetailExpand }: IAppInfoProps) => {
  const { isCurrentWorkspaceEditor } = useAppContext()

  const {
    appDetail,
    panelOpen,
    setPanelOpen,
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
  } = useAppInfoActions({ onDetailExpand })

  if (!appDetail)
    return null

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
      <AppInfoDetailPanel
        appDetail={appDetail}
        show={onlyShowDetail ? openState : panelOpen}
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
    </div>
  )
}

export default React.memo(AppInfo)
