'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useModalContext } from '@/context/modal-context'
import { SquareChecklist } from '../../base/icons/src/vender/other'
import styles from './style.module.css'

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
    <Modal
      isShow={show}
      onClose={onClose}
      closable={false}
      clickOutsideNotClose
      className={`${styles.surface} w-[580px] rounded-2xl !p-0`}
    >
      <div className="relative">
        <div
          aria-hidden
          className={`${styles.heroOverlay} pointer-events-none absolute inset-0`}
        />
        <div className="px-8 pt-8">
          <div className={`${styles.icon} flex size-12 items-center justify-center rounded-xl shadow-lg backdrop-blur-[5px]`}>
            <Icon className="size-6 text-text-primary-on-surface" />
          </div>
          <div className="mt-6 space-y-2">
            <div className={`${styles.highlight} title-3xl-semi-bold`}>
              {title}
            </div>
            <div className="system-md-regular text-text-tertiary">
              {description}
            </div>
          </div>
          {extraInfo}
        </div>
      </div>

      <div className="mb-8 mt-10 flex justify-end space-x-2 px-8">
        <Button
          onClick={onClose}
        >
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
      </div>
    </Modal>
  )
}

export default React.memo(PlanUpgradeModal)
