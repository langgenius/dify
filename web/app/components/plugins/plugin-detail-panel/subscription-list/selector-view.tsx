'use client'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import cn from '@/utils/classnames'
import { RiCheckLine, RiDeleteBinLine, RiWebhookLine } from '@remixicon/react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreateButtonType, CreateSubscriptionButton } from './create'
import { DeleteConfirm } from './delete-confirm'

type SubscriptionSelectorProps = {
  subscriptions?: TriggerSubscription[]
  isLoading: boolean
  selectedId?: string
  onSelect?: ({ id, name }: { id: string, name: string }) => void
}

export const SubscriptionSelectorView: React.FC<SubscriptionSelectorProps> = ({
  subscriptions,
  isLoading,
  selectedId,
  onSelect,
}) => {
  const { t } = useTranslation()
  const [deletedSubscription, setDeletedSubscription] = useState<TriggerSubscription | null>(null)
  const subscriptionCount = subscriptions?.length || 0

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-8'>
        <div className='text-text-tertiary'>{t('common.dataLoading')}</div>
      </div>
    )
  }

  return (
    <div className='w-[320px] p-1'>
      {subscriptionCount > 0 && <div className='ml-7 mr-1.5 mt-0.5 flex items-center justify-between'>
        <div className='flex shrink-0 items-center gap-1'>
          <span className='system-sm-semibold-uppercase text-text-secondary'>
            {t('pluginTrigger.subscription.listNum', { num: subscriptionCount })}
          </span>
          <Tooltip popupContent={t('pluginTrigger.subscription.list.tip')} />
        </div>
        <CreateSubscriptionButton
          buttonType={CreateButtonType.ICON_BUTTON}
        />
      </div>}
      <div className='max-h-[320px] overflow-y-auto'>
        {subscriptionCount > 0 ? (
          <>
            {subscriptions?.map(subscription => (
              <button
                key={subscription.id}
                className={cn(
                  'group flex w-full items-center justify-between rounded-lg p-1 text-left transition-colors',
                  'hover:bg-state-base-hover has-[.subscription-delete-btn:hover]:!bg-state-destructive-hover',
                  selectedId === subscription.id && 'bg-state-base-hover',
                )}
                onClick={() => onSelect?.(subscription)}
              >
                <div className='flex items-center'>
                  {selectedId === subscription.id && (
                    <RiCheckLine className='mr-2 h-4 w-4 shrink-0 text-text-accent' />
                  )}
                  <RiWebhookLine className={cn('mr-1.5 h-3.5 w-3.5 text-text-secondary', selectedId !== subscription.id && 'ml-6')} />
                  <span className='system-md-regular leading-6 text-text-secondary'>
                    {subscription.name}
                  </span>
                </div>
                <ActionButton onClick={(e) => {
                  e.stopPropagation()
                  setDeletedSubscription(subscription)
                }} className='subscription-delete-btn hidden shrink-0 text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive group-hover:flex'>
                  <RiDeleteBinLine className='size-4' />
                </ActionButton>
              </button>
            ))}
          </>
        ) : (
          // todo: refactor this
          <div className='p-2 text-center'>
            <div className='mb-2 text-sm text-text-tertiary'>
              {t('pluginTrigger.subscription.empty.description')}
            </div>
            <CreateSubscriptionButton
              buttonType={CreateButtonType.FULL_BUTTON}
            />
          </div>
        )}
      </div>
      {deletedSubscription && (
        <DeleteConfirm
          onClose={(deleted) => {
            if (deleted)
              onSelect?.({ id: '', name: '' })
            setDeletedSubscription(null)
          }}
          isShow={!!deletedSubscription}
          currentId={deletedSubscription.id}
          currentName={deletedSubscription.name}
        />
      )}
    </div>
  )
}
