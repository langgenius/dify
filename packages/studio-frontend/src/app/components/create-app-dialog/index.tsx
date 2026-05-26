'use client'
import { useTranslation } from 'react-i18next'
import { CreateAppDialogShell } from '@/app/components/app/create-app-dialog-shell'
import AppList from '@/app/components/app/create-app-dialog/app-list/index'

type CreateAppDialogProps = {
  show: boolean
  onSuccess: () => void
  onClose: () => void
  onCreateFromBlank?: () => void
}

const CreateAppTemplateDialog = ({ show, onSuccess, onClose, onCreateFromBlank }: CreateAppDialogProps) => {
  const { t } = useTranslation()

  return (
    <CreateAppDialogShell show={show} title={t('newApp.startFromTemplate', { ns: 'app' })} onClose={onClose}>
      <AppList
        onCreateFromBlank={onCreateFromBlank}
        onSuccess={() => {
          onSuccess()
          onClose()
        }}
      />
    </CreateAppDialogShell>
  )
}

export default CreateAppTemplateDialog
