import type { AppInfoActions } from './use-app-info-actions'
import AppInfoModals from './app-info-modals'
import AppInfoTrigger from './app-info-trigger'

type AppInfoViewProps = {
  expand: boolean
  actions: AppInfoActions
}

export const AppInfoView = ({ expand, actions }: AppInfoViewProps) => {
  const {
    appDetail,
    activeModal,
    openModal,
    closeModal,
    secretEnvList,
    setSecretEnvList,
    onEdit,
    onCopy,
    onExport,
    isExporting,
    exportCheck,
    handleConfirmExport,
    onConfirmDelete,
  } = actions

  if (!appDetail) return null

  return (
    <>
      <AppInfoTrigger
        appDetail={appDetail}
        expand={expand}
        openModal={openModal}
        isExporting={isExporting}
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
        isExporting={isExporting}
        exportCheck={exportCheck}
        handleConfirmExport={handleConfirmExport}
        onConfirmDelete={onConfirmDelete}
      />
    </>
  )
}
