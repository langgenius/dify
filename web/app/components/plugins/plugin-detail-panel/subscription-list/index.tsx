'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { RiAddLine } from '@remixicon/react'
import SubscriptionCard from './subscription-card'
import SubscriptionAddModal from './subscription-add-modal'
import AddTypeDropdown from './add-type-dropdown'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import { useTriggerSubscriptions } from '@/service/use-triggers'
import type { PluginDetail } from '@/app/components/plugins/types'
import cn from '@/utils/classnames'

type Props = {
  detail: PluginDetail
}

type SubscriptionAddType = 'api-key' | 'oauth' | 'manual'

export const SubscriptionList = ({ detail }: Props) => {
  const { t } = useTranslation()
  const showTopBorder = detail.declaration.tool || detail.declaration.endpoint

  const { data: subscriptions, isLoading, refetch } = useTriggerSubscriptions(`${detail.plugin_id}/${detail.declaration.name}`)

  const [isShowAddModal, {
    setTrue: showAddModal,
    setFalse: hideAddModal,
  }] = useBoolean(false)

  const [selectedAddType, setSelectedAddType] = React.useState<SubscriptionAddType | null>(null)

  const [isShowAddDropdown, {
    setTrue: showAddDropdown,
    setFalse: hideAddDropdown,
  }] = useBoolean(false)

  const handleAddTypeSelect = (type: SubscriptionAddType) => {
    setSelectedAddType(type)
    hideAddDropdown()
    showAddModal()
  }

  const handleModalClose = () => {
    hideAddModal()
    setSelectedAddType(null)
  }

  const handleRefreshList = () => {
    refetch()
  }

  if (isLoading) {
    return (
      <div className={cn('border-divider-subtle px-4 py-2', showTopBorder && 'border-t')}>
        <div className='flex items-center justify-center py-8'>
          <div className='text-text-tertiary'>{t('common.dataLoading')}</div>
        </div>
      </div>
    )
  }

  const hasSubscriptions = subscriptions && subscriptions.length > 0

  return (
    <div className={cn('border-divider-subtle px-4 py-2', showTopBorder && 'border-t')}>
      {!hasSubscriptions ? (
        <div className='relative w-full'>
          <Button
            variant='primary'
            size='medium'
            className='w-full'
            onClick={showAddDropdown}
          >
            <RiAddLine className='mr-2 h-4 w-4' />
            {t('pluginTrigger.subscription.empty.button')}
          </Button>
          {isShowAddDropdown && (
            <AddTypeDropdown
              onSelect={handleAddTypeSelect}
              onClose={hideAddDropdown}
            />
          )}
        </div>
      ) : (
        <>
          <div className='system-sm-semibold-uppercase relative mb-3 flex items-center justify-between'>
            <div className='flex items-center gap-1'>
              <span className='system-sm-semibold text-text-secondary'>
                {t('pluginTrigger.subscription.listNum', { num: subscriptions?.length || 0 })}
              </span>
              <Tooltip popupContent={t('pluginTrigger.subscription.list.tip')} />
            </div>
            <ActionButton onClick={showAddDropdown}>
              <RiAddLine className='h-4 w-4' />
            </ActionButton>
            {isShowAddDropdown && (
              <AddTypeDropdown
                onSelect={handleAddTypeSelect}
                onClose={hideAddDropdown}
              />
            )}
          </div>

          <div className='flex flex-col gap-1'>
            {subscriptions?.map(subscription => (
              <SubscriptionCard
                key={subscription.id}
                data={subscription}
                onRefresh={handleRefreshList}
              />
            ))}
          </div>
        </>
      )}

      {isShowAddModal && selectedAddType && (
        <SubscriptionAddModal
          type={selectedAddType}
          pluginDetail={detail}
          onClose={handleModalClose}
          onSuccess={handleRefreshList}
        />
      )}
    </div>
  )
}
