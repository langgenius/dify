'use client'
import { useTranslation } from 'react-i18next'
import { CreateAppDialogShell } from '../create-app-dialog-shell'
import AppList from './app-list'

type CreateAppDialogProps = {
  /** Server-renders the dialog in place, for a route that is only this dialog. */
  inline?: boolean
  show: boolean
  onClose: () => void
  /** Runs once an app is created from a template; closes the dialog by default. */
  onCreated?: () => void
  onCreateFromBlank?: () => void
  templateMode?: 'agent'
}

const CreateAppTemplateDialog = ({
  inline,
  show,
  onClose,
  onCreated,
  onCreateFromBlank,
  templateMode,
}: CreateAppDialogProps) => {
  const { t } = useTranslation(['app'])

  return (
    <CreateAppDialogShell
      inline={inline}
      show={show}
      title={t(($) => $['newApp.startFromTemplate'], { ns: 'app' })}
      onClose={onClose}
    >
      <AppList
        onCreateFromBlank={onCreateFromBlank}
        onClose={onClose}
        onCreated={onCreated}
        templateMode={templateMode}
      />
    </CreateAppDialogShell>
  )
}

export default CreateAppTemplateDialog
