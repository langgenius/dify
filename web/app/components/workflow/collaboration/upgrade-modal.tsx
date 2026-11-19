import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { PlanUpgradeModal } from '@/app/components/billing/plan-upgrade-modal'
import { collaborationUpgradeDialogAtom } from './upgrade-state'

export function CollaborationUpgradeModal() {
  const { t } = useTranslation(['billing'])
  const dialog = useAtomValue(collaborationUpgradeDialogAtom)
  if (!dialog) return null

  return (
    <PlanUpgradeModal
      dialogHandle={dialog}
      iconClassName="i-ri-group-line"
      loc="workflow-collaboration-upgrade-modal"
      title={t(($) => $['upgrade.workflowCollaboration.title'], { ns: 'billing' })}
      description={t(($) => $['upgrade.workflowCollaboration.description'], { ns: 'billing' })}
    />
  )
}
