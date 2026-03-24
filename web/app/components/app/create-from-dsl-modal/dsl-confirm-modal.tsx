import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@/app/components/base/ui/dialog'
import { toast } from '@/app/components/base/ui/toast'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { DSLImportStatus } from '@/models/app'
import { useRouter } from '@/next/navigation'
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
        if (status === DSLImportStatus.COMPLETED)
          toast.success(t('newApp.appCreated', { ns: 'app' }))
        else
          toast.warning(t('newApp.caution', { ns: 'app' }), { description: t('newApp.appCreateDSLWarning', { ns: 'app' }) })
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        if (app_id)
          await handleCheckPluginDependencies(app_id)
        if (app_id)
          getRedirection(isCurrentWorkspaceEditor, { id: app_id, mode: app_mode }, push)
        onSuccess?.()
        onCancel()
      }
      else {
        toast.error(t('importBundleFailed', { ns: 'app' }))
      }
    }
    catch (e) {
      const error = e as Error
      toast.error(error.message || t('importBundleFailed', { ns: 'app' }))
    }
    finally {
      setIsImporting(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent className="w-[480px]">
        <DialogCloseButton />
        <div className="flex flex-col items-start gap-2 self-stretch pb-4">
          <DialogTitle className="text-text-primary title-2xl-semi-bold">
            {t('newApp.appCreateDSLErrorTitle', { ns: 'app' })}
          </DialogTitle>
          <div className="flex grow flex-col text-text-secondary system-md-regular">
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
      </DialogContent>
    </Dialog>
  )
}

export default DSLConfirmModal
