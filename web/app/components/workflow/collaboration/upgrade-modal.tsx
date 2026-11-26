import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { PlanUpgradeModal } from '@/app/components/billing/plan-upgrade-modal'
import { collaborationUpgradeClickedAtom, collaborationUpgradeDialogAtom } from './upgrade-state'

export function CollaborationUpgradeModal() {
  const { t } = useTranslation(['billing'])
  const dialog = useAtomValue(collaborationUpgradeDialogAtom)
  const trackUpgradeClick = useSetAtom(collaborationUpgradeClickedAtom)
  if (!dialog) return null

  return (
    <PlanUpgradeModal
      dialogHandle={dialog}
      iconClassName="i-ri-group-line"
      loc="workflow-collaboration-upgrade-modal"
      onUpgrade={trackUpgradeClick}
      title={t(($) => $['upgrade.workflowCollaboration.title'], { ns: 'billing' })}
      description={t(($) => $['upgrade.workflowCollaboration.description'], { ns: 'billing' })}
    />
  )
}
