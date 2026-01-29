'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import UpgradeModalBase from '@/app/components/base/upgrade-modal'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useModalContext } from '@/context/modal-context'
import { SquareChecklist } from '../../base/icons/src/vender/other'

type Props = {
  Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title: string
  description: string
  extraInfo?: React.ReactNode
  show: boolean
  onClose: () => void
  onUpgrade?: () => void
}

const PlanUpgradeModal: FC<Props> = ({
  Icon = SquareChecklist,
  title,
  description,
  extraInfo,
  show,
  onClose,
  onUpgrade,
}) => {
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
    <UpgradeModalBase
      show={show}
      onClose={onClose}
      // eslint-disable-next-line ts/no-explicit-any
      Icon={Icon as any}
      title={title}
      description={description}
      extraInfo={extraInfo}
      footer={(
        <>
          <Button onClick={onClose}>
            {t('triggerLimitModal.dismiss', { ns: 'billing' })}
          </Button>
          <UpgradeBtn
            size="custom"
            isShort
            onClick={handleUpgrade}
            className="!h-8 !rounded-lg px-2"
            labelKey="triggerLimitModal.upgrade"
            loc="trigger-events-limit-modal"
          />
        </>
      )}
    />
  )
}

export default React.memo(PlanUpgradeModal)
