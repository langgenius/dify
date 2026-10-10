'use client'
import { useTranslation } from 'react-i18next'
import { CreateAppDialogShell } from '../create-app-dialog-shell'
import AppList from './app-list'

type CreateAppDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateFromBlank?: () => void
  templateMode?: 'agent'
}

export function CreateAppTemplateDialog({
  open,
  onOpenChange,
  onCreateFromBlank,
  templateMode,
}: CreateAppDialogProps) {
  const { t } = useTranslation(['app'])

  return (
    <CreateAppDialogShell
      open={open}
      title={t(($) => $['newApp.startFromTemplate'], { ns: 'app' })}
      onOpenChange={onOpenChange}
    >
      <AppList
        onCreateFromBlank={onCreateFromBlank}
        onClose={() => onOpenChange(false)}
        templateMode={templateMode}
      />
    </CreateAppDialogShell>
  )
}
