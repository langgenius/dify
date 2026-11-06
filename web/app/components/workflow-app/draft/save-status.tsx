import { useTranslation } from 'react-i18next'
import EditingTitle from '@/app/components/workflow/header/editing-title'
import { useWorkflowAppSelector } from '../store/workflow'

export function WorkflowAppSaveStatus() {
  const { t } = useTranslation(['workflow'])
  const hasConflict = useWorkflowAppSelector((state) => state.hasWorkflowDraftConflict)
  return (
    <EditingTitle
      saveStatus={hasConflict ? <span>{t(($) => $['draftConflict.unsaved'])}</span> : undefined}
    />
  )
}
