'use client'
import { useTranslation } from 'react-i18next'
import { CreateAppDialogShell } from '../create-app-dialog-shell'
import AppList from './app-list'

type CreateAppDialogProps = {
  show: boolean
  onClose: () => void
  onCreateFromBlank?: () => void
}

const CreateAppTemplateDialog = ({ show, onClose, onCreateFromBlank }: CreateAppDialogProps) => {
  const { t } = useTranslation()

  return (
    <CreateAppDialogShell
      show={show}
      title={t(($) => $['newApp.startFromTemplate'], { ns: 'app' })}
      onClose={onClose}
    >
      <AppList onCreateFromBlank={onCreateFromBlank} onClose={onClose} />
    </CreateAppDialogShell>
  )
}

export default CreateAppTemplateDialog
