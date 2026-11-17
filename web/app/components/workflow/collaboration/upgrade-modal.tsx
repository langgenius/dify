import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { PlanUpgradeModal } from '@/app/components/billing/plan-upgrade-modal'
import { collaborationUpgradeOpenAtom } from '../editor-resource/state'
import { collaborationUpgradeAvailableAtom } from './upgrade-state'

export function CollaborationUpgradeModal() {
  const { t } = useTranslation(['billing'])
  const available = useAtomValue(collaborationUpgradeAvailableAtom)
  const [open, setOpen] = useAtom(collaborationUpgradeOpenAtom)
  if (!available) return null

  return (
    <PlanUpgradeModal
      show={open}
      onClose={() => setOpen(false)}
      iconClassName="i-ri-group-line"
      loc="workflow-collaboration-upgrade-modal"
      title={t(($) => $['upgrade.workflowCollaboration.title'], { ns: 'billing' })}
      description={t(($) => $['upgrade.workflowCollaboration.description'], { ns: 'billing' })}
    />
  )
}
