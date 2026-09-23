import AppInfoModals from './app-info-modals'
import AppInfoTrigger from './app-info-trigger'
import { useAppInfoActions } from './use-app-info-actions'

type AppInfoViewProps = {
  expand: boolean
}

export const AppInfoView = ({ expand }: AppInfoViewProps) => {
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
  } = useAppInfoActions()

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
