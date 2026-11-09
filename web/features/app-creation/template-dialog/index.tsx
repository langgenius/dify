'use client'
import { useTranslation } from 'react-i18next'
import { CreateAppDialogShell } from '../dialog-shell'
import AppList from './template-list'

type CreateAppDialogProps = {
  show: boolean
  onClose: () => void
  onCreated?: () => void
  templateMode?: 'agent'
}

const CreateAppTemplateDialog = ({
  show,
  onClose,
  onCreated,
  templateMode,
}: CreateAppDialogProps) => {
  const { t } = useTranslation(['app'])

  return (
    <CreateAppDialogShell
      show={show}
      title={t(($) => $['newApp.startFromTemplate'], { ns: 'app' })}
      onClose={onClose}
    >
      <AppList onCreated={onCreated} templateMode={templateMode} />
    </CreateAppDialogShell>
  )
}

export default CreateAppTemplateDialog
