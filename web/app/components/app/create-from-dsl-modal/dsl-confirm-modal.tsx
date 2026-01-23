import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { useToastContext } from '@/app/components/base/toast'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { DSLImportStatus } from '@/models/app'
import { importAppBundle } from '@/service/apps'
import { getRedirection } from '@/utils/app-redirection'

type DSLConfirmModalProps = {
  file?: File
  versions?: {
    importedVersion: string
    systemVersion: string
  }
  onCancel: () => void
  onConfirm: () => void
  onSuccess?: () => void
  confirmDisabled?: boolean
}
const DSLConfirmModal = ({
  file,
  versions = { importedVersion: '', systemVersion: '' },
  onCancel,
  onConfirm,
  onSuccess,
  confirmDisabled = false,
}: DSLConfirmModalProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { push } = useRouter()
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const [isImporting, setIsImporting] = useState(false)
  const isZipFile = !!file && file.name.toLowerCase().endsWith('.zip')

  const handleConfirm = async () => {
    if (confirmDisabled || isImporting)
      return
    if (!isZipFile) {
      onConfirm()
      return
    }
    if (!file)
      return

    setIsImporting(true)
    try {
      const response = await importAppBundle({ file })
      const { status, app_id, app_mode } = response

      if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
        notify({
          type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
          message: t(status === DSLImportStatus.COMPLETED ? 'newApp.appCreated' : 'newApp.caution', { ns: 'app' }),
          children: status === DSLImportStatus.COMPLETED_WITH_WARNINGS && t('newApp.appCreateDSLWarning', { ns: 'app' }),
        })
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        if (app_id)
          await handleCheckPluginDependencies(app_id)
        if (app_id)
          getRedirection(isCurrentWorkspaceEditor, { id: app_id, mode: app_mode }, push)
        onSuccess?.()
        onCancel()
      }
      else {
        notify({ type: 'error', message: t('importBundleFailed', { ns: 'app' }) })
      }
    }
    catch (e) {
      const error = e as Error
      notify({ type: 'error', message: error.message || t('importBundleFailed', { ns: 'app' }) })
    }
    finally {
      setIsImporting(false)
    }
  }

  return (
    <Modal
      isShow
      onClose={() => onCancel()}
      className="w-[480px]"
    >
      <div className="flex flex-col items-start gap-2 self-stretch pb-4">
        <div className="title-2xl-semi-bold text-text-primary">{t('newApp.appCreateDSLErrorTitle', { ns: 'app' })}</div>
        <div className="system-md-regular flex grow flex-col text-text-secondary">
          <div>{t('newApp.appCreateDSLErrorPart1', { ns: 'app' })}</div>
          <div>{t('newApp.appCreateDSLErrorPart2', { ns: 'app' })}</div>
          <br />
          <div>
            {t('newApp.appCreateDSLErrorPart3', { ns: 'app' })}
            <span className="system-md-medium">{versions.importedVersion}</span>
          </div>
          <div>
            {t('newApp.appCreateDSLErrorPart4', { ns: 'app' })}
            <span className="system-md-medium">{versions.systemVersion}</span>
          </div>
        </div>
      </div>
      <div className="flex items-start justify-end gap-2 self-stretch pt-6">
        <Button variant="secondary" onClick={() => onCancel()}>{t('newApp.Cancel', { ns: 'app' })}</Button>
        <Button
          variant="primary"
          destructive
          onClick={handleConfirm}
          disabled={confirmDisabled || isImporting}
          loading={isImporting}
        >
          {t('newApp.Confirm', { ns: 'app' })}
        </Button>
      </div>
    </Modal>
  )
}

export default DSLConfirmModal
