'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import UsageInfo from '@/app/components/billing/usage-info'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import type { Plan } from '@/app/components/billing/type'
import styles from './index.module.css'

type Props = {
  show: boolean
  onDismiss: () => void
  onUpgrade: () => void
  usage: number
  total: number
  resetInDays?: number
  planType: Plan
}

const TriggerEventsLimitModal: FC<Props> = ({
  show,
  onDismiss,
  onUpgrade,
  usage,
  total,
  resetInDays,
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      isShow={show}
      onClose={onDismiss}
      closable={false}
      clickOutsideNotClose
      className={`${styles.surface} flex h-[360px] w-[580px] flex-col overflow-hidden rounded-2xl !p-0 shadow-xl`}
    >
      <div className='relative flex w-full flex-1 items-stretch justify-center'>
        <div
          aria-hidden
          className={`${styles.heroOverlay} pointer-events-none absolute inset-0`}
        />
        <div className='relative z-10 flex w-full flex-col items-start gap-4 px-8 pt-8'>
          <div className={`${styles.icon} flex h-12 w-12 items-center justify-center rounded-[12px]`}>
            <TriggerAll className='h-5 w-5 text-text-primary-on-surface' />
          </div>
          <div className='flex flex-col items-start gap-2'>
            <div className={`${styles.highlight} title-lg-semi-bold`}>
              {t('billing.triggerLimitModal.title')}
            </div>
            <div className='body-md-regular text-text-secondary'>
              {t('billing.triggerLimitModal.description')}
            </div>
          </div>
          <UsageInfo
            className='mb-5 w-full rounded-[12px] bg-components-panel-on-panel-item-bg'
            Icon={TriggerAll}
            name={t('billing.triggerLimitModal.usageTitle')}
            usage={usage}
            total={total}
            resetInDays={resetInDays}
            hideIcon
          />
        </div>
      </div>

      <div className='flex h-[76px] w-full items-center justify-end gap-2 px-8 pb-8 pt-5'>
        <Button
          className='h-8 w-[77px] min-w-[72px] !rounded-lg !border-[0.5px] px-3 py-2'
          onClick={onDismiss}
        >
          {t('billing.triggerLimitModal.dismiss')}
        </Button>
        <UpgradeBtn
          isShort
          onClick={onUpgrade}
          className='flex w-[93px] items-center justify-center !rounded-lg !px-2'
          style={{ height: 32 }}
          labelKey='billing.triggerLimitModal.upgrade'
          loc='trigger-events-limit-modal'
        />
      </div>
    </Modal>
  )
}

export default React.memo(TriggerEventsLimitModal)
