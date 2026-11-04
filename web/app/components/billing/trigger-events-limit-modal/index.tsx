'use client'
import type { BillingQuota } from '../quota'
import { useTranslation } from 'react-i18next'
import { PlanUpgradeModal } from '@/app/components/billing/plan-upgrade-modal'
import UsageInfo from '@/app/components/billing/usage-info'

type Props = Readonly<{
  show: boolean
  onClose: () => void
  quota: BillingQuota
}>

export default function TriggerEventsLimitModal({ show, onClose, quota }: Props) {
  const { t } = useTranslation(['billing'])

  return (
    <PlanUpgradeModal
      show={show}
      onClose={onClose}
      iconClassName={'i-custom-vender-workflow-trigger-all'}
      title={t(($) => $['triggerLimitModal.title'], { ns: 'billing' })}
      description={t(($) => $['triggerLimitModal.description'], { ns: 'billing' })}
      extraInfo={
        <UsageInfo
          className="mt-4 w-full rounded-xl bg-components-panel-on-panel-item-bg"
          iconClassName={'i-custom-vender-workflow-trigger-all'}
          name={t(($) => $['triggerLimitModal.usageTitle'], { ns: 'billing' })}
          quota={quota}
          hideIcon
        />
      }
    />
  )
}
