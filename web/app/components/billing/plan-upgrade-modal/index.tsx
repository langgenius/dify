'use client'

import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { DialogClose } from '@langgenius/dify-ui/dialog'
import { useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import { UpgradeModal } from '@/app/components/base/upgrade-modal'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'

type Props = Readonly<
  {
    iconClassName?: string
    title: string
    description: string
    extraInfo?: ReactNode
    loc?: string
  } & (
    | { show: boolean; onClose: () => void; dialogHandle?: never }
    | { dialogHandle: DialogHandle; show?: never; onClose?: never }
  )
>

export function PlanUpgradeModal({
  iconClassName = 'i-custom-vender-other-square-checklist',
  title,
  description,
  extraInfo,
  loc = 'trigger-events-limit-modal',
  show,
  dialogHandle,
  onClose,
}: Props) {
  const { t } = useTranslation(['billing'])
  const [, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)

  const handleUpgrade = () => {
    if (dialogHandle) dialogHandle.close()
    else onClose()
    void setPricing('open')
  }

  return (
    <UpgradeModal
      open={show}
      dialogHandle={dialogHandle}
      onOpenChange={(open) => {
        if (!open) onClose?.()
      }}
      iconClassName={iconClassName}
      title={title}
      description={description}
      extraInfo={extraInfo}
      footer={
        <>
          <DialogClose render={<Button />}>
            {t(($) => $['triggerLimitModal.dismiss'], { ns: 'billing' })}
          </DialogClose>
          <UpgradeBtn
            size="custom"
            isShort
            onClick={handleUpgrade}
            className="h-8! rounded-lg! px-2"
            labelKey="triggerLimitModal.upgrade"
            loc={loc}
          />
        </>
      }
    />
  )
}
