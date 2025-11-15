'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { TriggerAll } from '@/app/components/base/icons/src/vender/workflow'
import UsageInfo from '@/app/components/billing/usage-info'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { NUM_INFINITE } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import cn from '@/utils/classnames'
import s from './style.module.css'

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
  planType,
}) => {
  const { t } = useTranslation()

  const triggerResetInDays = planType === Plan.professional && total !== NUM_INFINITE ? resetInDays : undefined

  return (
    <Modal
      isShow={show}
      onClose={onDismiss}
      closable={false}
      clickOutsideNotClose
      className={cn('flex flex-col !p-0', s.container)}
    >
      <div className={s.hero}>
        <div className={s.heroContent}>
          <div className={s.iconWrapper}>
            <TriggerAll className='h-5 w-5 text-text-primary-on-surface' />
          </div>
          <div className={s.copyBlock}>
            <div className={cn('title-lg-semi-bold', s.highlight)}>
              {t('billing.triggerLimitModal.title')}
            </div>
            <div className='body-md-regular text-text-secondary'>
              {t('billing.triggerLimitModal.description')}
            </div>
          </div>
          <UsageInfo
            className={cn('w-full', s.usageCard)}
            Icon={TriggerAll}
            name={t('billing.triggerLimitModal.usageTitle')}
            usage={usage}
            total={total}
            resetInDays={triggerResetInDays}
            hideIcon
          />
        </div>
      </div>

      <div className={s.footer}>
        <Button
          className='!rounded-lg !border-[0.5px]'
          onClick={onDismiss}
          style={{
            width: 77,
            minWidth: 72,
            height: 32,
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 12,
            paddingRight: 12,
          }}
        >
          {t('billing.triggerLimitModal.dismiss')}
        </Button>
        <UpgradeBtn
          isShort
          onClick={onUpgrade}
          className='!rounded-lg'
          style={{
            width: 93,
            height: 32,
            padding: 8,
          }}
          labelKey='billing.triggerLimitModal.upgrade'
          loc='trigger-events-limit-modal'
        />
      </div>
    </Modal>
  )
}

export default React.memo(TriggerEventsLimitModal)
