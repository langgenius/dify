'use client'
import { useTranslation } from 'react-i18next'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
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
  const { t } = useTranslation()

  return (
    <PlanUpgradeModal
      show={show}
      onClose={onClose}
      Icon={TriggerAll}
      title={t(($) => $['triggerLimitModal.title'], { ns: 'billing' })}
      description={t(($) => $['triggerLimitModal.description'], { ns: 'billing' })}
      extraInfo={
        <UsageInfo
          className="mt-4 w-full rounded-xl bg-components-panel-on-panel-item-bg"
          Icon={TriggerAll}
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
