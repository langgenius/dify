'use client'
import type { ComponentType, ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { UpgradeModal } from '@/app/components/base/upgrade-modal'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useModalContext } from '@/context/modal-context'
import { SquareChecklist } from '../../base/icons/src/vender/other'

type Props = {
  Icon?: ComponentType<{ className?: string }>
  title: string
  description: string
  extraInfo?: ReactNode
  show: boolean
  onClose: () => void
  onUpgrade?: () => void
}

export function PlanUpgradeModal({
  Icon = SquareChecklist,
  title,
  description,
  extraInfo,
  show,
  onClose,
  onUpgrade,
}: Props) {
  const { t } = useTranslation()
  const { setShowPricingModal } = useModalContext()

  const handleUpgrade = useCallback(() => {
    onClose()
    if (onUpgrade)
      onUpgrade()
    else
      setShowPricingModal()
  }, [onClose, onUpgrade, setShowPricingModal])

  return (
    <UpgradeModal
      open={show}
      onOpenChange={open => !open && onClose()}
      Icon={Icon}
      title={title}
      description={description}
      extraInfo={extraInfo}
      footer={(
        <>
          <Button
            onClick={onClose}
          >
            {t('triggerLimitModal.dismiss', { ns: 'billing' })}
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
      )}
    />
  )
}
