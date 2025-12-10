'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import UsageInfo from '@/app/components/billing/usage-info'
import PlanUpgradeModal from '@/app/components/billing/plan-upgrade-modal'

type Props = {
  show: boolean
  onClose: () => void
  onUpgrade: () => void
  usage: number
  total: number
  resetInDays?: number
}

const TriggerEventsLimitModal: FC<Props> = ({
  show,
  onClose,
  onUpgrade,
  usage,
  total,
  resetInDays,
}) => {
  const { t } = useTranslation()

  return (
    <PlanUpgradeModal
      show={show}
      onClose={onClose}
      onUpgrade={onUpgrade}
      Icon={TriggerAll as React.ComponentType<React.SVGProps<SVGSVGElement>>}
      title={t('billing.triggerLimitModal.title')}
      description={t('billing.triggerLimitModal.description')}
      extraInfo={(
        <UsageInfo
          className='mt-4 w-full rounded-[12px] bg-components-panel-on-panel-item-bg'
          Icon={TriggerAll}
          name={t('billing.triggerLimitModal.usageTitle')}
          usage={usage}
          total={total}
          resetInDays={resetInDays}
          hideIcon
        />
      )}
    />
  )
}

export default React.memo(TriggerEventsLimitModal)
