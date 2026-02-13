import type { ActiveModal } from '../hooks/use-app-info-actions'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import type { App, AppSSO } from '@/types/app'
import dynamic from 'next/dynamic'
import { useTranslation } from 'react-i18next'

const SwitchAppModal = dynamic(() => import('@/app/components/app/switch-app-modal'), {
  ssr: false,
})
const CreateAppModal = dynamic(() => import('@/app/components/explore/create-app-modal'), {
  ssr: false,
})
const DuplicateAppModal = dynamic(() => import('@/app/components/app/duplicate-modal'), {
  ssr: false,
})
const Confirm = dynamic(() => import('@/app/components/base/confirm'), {
  ssr: false,
})
const UpdateDSLModal = dynamic(() => import('@/app/components/workflow/update-dsl-modal'), {
  ssr: false,
})
const DSLExportConfirmModal = dynamic(() => import('@/app/components/workflow/dsl-export-confirm-modal'), {
  ssr: false,
})

type AppInfoModalsProps = {
  appDetail: App & Partial<AppSSO>
  activeModal: ActiveModal
  showExportWarning: boolean
  secretEnvList: EnvironmentVariable[]
  onCloseModal: () => void
  onCloseExportWarning: () => void
  onEdit: CreateAppModalProps['onConfirm']
  onCopy: DuplicateAppModalProps['onConfirm']
  onExport: (include?: boolean) => Promise<void>
  onConfirmDelete: () => void
  onConfirmExport: () => void
  onExportCheck: () => void
  onClearSecretEnvList: () => void
}

const AppInfoModals = ({
  appDetail,
  activeModal,
  showExportWarning,
  secretEnvList,
  onCloseModal,
  onCloseExportWarning,
  onEdit,
  onCopy,
  onExport,
  onConfirmDelete,
  onConfirmExport,
  onExportCheck,
  onClearSecretEnvList,
}: AppInfoModalsProps) => {
  const { t } = useTranslation()

  return (
    <>
      {activeModal === 'switch' && (
        <SwitchAppModal
          inAppDetail
          show
          appDetail={appDetail}
          onClose={onCloseModal}
          onSuccess={onCloseModal}
        />
      )}
      {activeModal === 'edit' && (
        <CreateAppModal
          isEditModal
          appName={appDetail.name}
          appIconType={appDetail.icon_type}
          appIcon={appDetail.icon}
          appIconBackground={appDetail.icon_background}
          appIconUrl={appDetail.icon_url}
          appDescription={appDetail.description}
          appMode={appDetail.mode}
          appUseIconAsAnswerIcon={appDetail.use_icon_as_answer_icon}
          max_active_requests={appDetail.max_active_requests ?? null}
          show
          onConfirm={onEdit}
          onHide={onCloseModal}
        />
      )}
      {activeModal === 'duplicate' && (
        <DuplicateAppModal
          appName={appDetail.name}
          icon_type={appDetail.icon_type}
          icon={appDetail.icon}
          icon_background={appDetail.icon_background}
          icon_url={appDetail.icon_url}
          show
          onConfirm={onCopy}
          onHide={onCloseModal}
        />
      )}
      {activeModal === 'confirmDelete' && (
        <Confirm
          title={t('deleteAppConfirmTitle', { ns: 'app' })}
          content={t('deleteAppConfirmContent', { ns: 'app' })}
          isShow
          onConfirm={onConfirmDelete}
          onCancel={onCloseModal}
        />
      )}
      {activeModal === 'importDSL' && (
        <UpdateDSLModal
          onCancel={onCloseModal}
          onBackup={onExportCheck}
        />
      )}
      {showExportWarning && (
        <Confirm
          type="info"
          isShow={showExportWarning}
          title={t('sidebar.exportWarning', { ns: 'workflow' })}
          content={t('sidebar.exportWarningDesc', { ns: 'workflow' })}
          onConfirm={onConfirmExport}
          onCancel={onCloseExportWarning}
        />
      )}
      {secretEnvList.length > 0 && (
        <DSLExportConfirmModal
          envList={secretEnvList}
          onConfirm={onExport}
          onClose={onClearSecretEnvList}
        />
      )}
    </>
  )
}

export default AppInfoModals
