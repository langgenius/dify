'use client'
import { useTranslation } from 'react-i18next'
import { CreateAppDialogShell } from '../dialog-shell'
import AppList from './template-list'

type CreateAppDialogProps = {
  legacyLayout?: boolean
  show: boolean
  onClose: () => void
  onCreateFromBlank?: () => void
  onCreated?: () => void
  templateMode?: 'agent'
}

const CreateAppTemplateDialog = ({
  legacyLayout,
  show,
  onClose,
  onCreateFromBlank,
  onCreated,
  templateMode,
}: CreateAppDialogProps) => {
  const { t } = useTranslation(['app'])

  return (
    <CreateAppDialogShell
      legacyLayout={legacyLayout}
      show={show}
      title={t(($) => $['newApp.startFromTemplate'], { ns: 'app' })}
      onClose={onClose}
    >
      <AppList
        onCreateFromBlank={onCreateFromBlank}
        onCreated={onCreated}
        templateMode={templateMode}
      />
    </CreateAppDialogShell>
  )
}

export default CreateAppTemplateDialog
