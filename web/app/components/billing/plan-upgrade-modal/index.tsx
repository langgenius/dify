'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
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
  Icon = TriggerAll,
  title,
  description,
  extraInfo,
  show,
  onClose: onClose,
  onUpgrade,
}) => {
  const { t } = useTranslation()
  // const { plan } = useProviderContext()
  return (
    <Modal
      isShow={show}
      onClose={onClose}
      closable={false}
      clickOutsideNotClose
      className={`${styles.surface} flex w-[580px] flex-col overflow-hidden rounded-2xl !p-0 shadow-xl`}
    >
      <div className='relative flex w-full flex-1 items-stretch justify-center'>
        <div
          aria-hidden
          className={`${styles.heroOverlay} pointer-events-none absolute inset-0`}
        />
        <div className='relative z-10 flex w-full flex-col items-start gap-4 px-8 pt-8'>
          <div className={`${styles.icon} flex h-12 w-12 items-center justify-center rounded-[12px]`}>
            <Icon className='h-5 w-5 text-text-primary-on-surface' />
          </div>
          <div className='flex flex-col items-start gap-2'>
            <div className={`${styles.highlight} title-lg-semi-bold`}>
              {title}
            </div>
            <div className='body-md-regular text-text-secondary'>
              {description}
            </div>
          </div>
          {extraInfo}
        </div>
      </div>

      <div className='flex h-[76px] w-full items-center justify-end gap-2 px-8 pb-8 pt-5'>
        <Button
          onClick={onClose}
        >
          {t('billing.triggerLimitModal.dismiss')}
        </Button>
        <UpgradeBtn
          isShort
          onClick={onUpgrade}
          style={{ height: 32 }}
          labelKey='billing.triggerLimitModal.upgrade'
          loc='trigger-events-limit-modal'
        />
      </div>
    </Modal>
  )
}

export default React.memo(PlanUpgradeModal)
