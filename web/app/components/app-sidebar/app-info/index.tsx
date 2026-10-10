import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import AppInfoModals from './app-info-modals'
import AppInfoTrigger from './app-info-trigger'
import { useAppInfoActions } from './use-app-info-actions'

type AppInfoViewProps = {
  appDetail: AppDetailWithSite
  expand: boolean
}

export const AppInfoView = ({ appDetail, expand }: AppInfoViewProps) => {
  const {
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
  } = useAppInfoActions({ appId: appDetail.id, appName: appDetail.name, appMode: appDetail.mode })

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
