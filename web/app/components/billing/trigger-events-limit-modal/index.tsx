'use client'
import { useTranslation } from 'react-i18next'
import { PlanUpgradeModal } from '@/app/components/billing/plan-upgrade-modal'
import UsageInfo from '@/app/components/billing/usage-info'

type Props = Readonly<{
  show: boolean
  onClose: () => void
  usage: number
  total: number
  resetInDays?: number
}>

export default function TriggerEventsLimitModal({
  show,
  onClose,
  usage,
  total,
  resetInDays,
}: Props) {
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
          usage={usage}
          total={total}
          resetInDays={resetInDays}
          hideIcon
        />
      }
    />
  )
}
