'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useQueryState } from 'nuqs'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { UpgradeModal } from '@/app/components/base/upgrade-modal'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'

type Props = Readonly<{
  iconClassName?: string
  title: string
  description: string
  extraInfo?: ReactNode
  show: boolean
  onClose: () => void
}>

export function PlanUpgradeModal({
  iconClassName = 'i-custom-vender-other-square-checklist',
  title,
  description,
  extraInfo,
  show,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const [, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)

  const handleUpgrade = useCallback(() => {
    onClose()
    setPricing('open')
  }, [onClose, setPricing])

  return (
    <UpgradeModal
      open={show}
      onOpenChange={(open) => !open && onClose()}
      iconClassName={iconClassName}
      title={title}
      description={description}
      extraInfo={extraInfo}
      footer={
        <>
          <Button onClick={onClose}>
            {t(($) => $['triggerLimitModal.dismiss'], { ns: 'billing' })}
          </Button>
          <UpgradeBtn
            size="custom"
            isShort
            onClick={handleUpgrade}
            className="h-8! rounded-lg! px-2"
            labelKey="triggerLimitModal.upgrade"
            loc="trigger-events-limit-modal"
          />
        </>
      }
    />
  )
}
