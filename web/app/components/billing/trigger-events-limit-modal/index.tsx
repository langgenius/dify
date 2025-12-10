'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import UsageInfo from '@/app/components/billing/usage-info'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import styles from './index.module.css'

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
    <Modal
      isShow={show}
      onClose={onClose}
      closable={false}
      clickOutsideNotClose
      className={`${styles.surface} w-[580px] rounded-2xl !p-0`}
    >
      <div className='relative'>
        <div
          aria-hidden
          className={`${styles.heroOverlay} pointer-events-none absolute inset-0`}
        />
        <div className='px-8 pt-8'>
          <div className={`${styles.icon} flex size-12 items-center justify-center rounded-xl shadow-lg backdrop-blur-[5px]`}>
            <TriggerAll className='size-6 text-text-primary-on-surface' />
          </div>
          <div className='mt-6 space-y-2'>
            <div className={`${styles.highlight} title-3xl-semi-bold`}>
              {t('billing.triggerLimitModal.title')}
            </div>
            <div className='system-md-regular text-text-tertiary'>
              {t('billing.triggerLimitModal.description')}
            </div>
          </div>
          <UsageInfo
            className='mt-4 w-full rounded-[12px] bg-components-panel-on-panel-item-bg'
            Icon={TriggerAll}
            name={t('billing.triggerLimitModal.usageTitle')}
            usage={usage}
            total={total}
            resetInDays={resetInDays}
            hideIcon
          />
        </div>
      </div>

      <div className='mb-8 mt-10 flex justify-end space-x-2 px-8'>
        <Button
          onClick={onClose}
        >
          {t('billing.triggerLimitModal.dismiss')}
        </Button>
        <UpgradeBtn
          isShort
          onClick={onUpgrade}
          className='!h-8 !rounded-lg'
          labelKey='billing.triggerLimitModal.upgrade'
          loc='trigger-events-limit-modal'
        />
      </div>
    </Modal>
  )
}

export default React.memo(TriggerEventsLimitModal)
