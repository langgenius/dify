'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import {
  RiAddLine,
  RiBookOpenLine,
  RiWebhookLine,
} from '@remixicon/react'
import { useDocLink } from '@/context/i18n'
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
  const docLink = useDocLink()
  const showTopBorder = detail.declaration.tool || detail.declaration.endpoint

  // Fetch subscriptions
  const { data: subscriptions, isLoading } = useTriggerSubscriptions(`${detail.plugin_id}/${detail.declaration.name}`)

  // Modal states
  const [isShowAddModal, {
    setTrue: showAddModal,
    setFalse: hideAddModal,
  }] = useBoolean(false)

  const [selectedAddType, setSelectedAddType] = React.useState<SubscriptionAddType | null>(null)

  // Dropdown state for add button
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
    // This will be called after successful operations
    // The query will auto-refresh due to React Query
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
              position='bottom'
            />
          )}
        </div>
      ) : (
        // List state with header and secondary add button
        <>
          <div className='system-sm-semibold-uppercase mb-3 flex h-6 items-center justify-between text-text-secondary'>
            <div className='flex items-center gap-0.5'>
              {t('pluginTrigger.subscription.list.title')}
              <Tooltip
                position='right'
                popupClassName='w-[240px] p-4 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border'
                popupContent={
                  <div className='flex flex-col gap-2'>
                    <div className='flex h-8 w-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle'>
                      <RiWebhookLine className='h-4 w-4 text-text-tertiary' />
                    </div>
                    <div className='system-xs-regular text-text-tertiary'>
                      {t('pluginTrigger.subscription.list.tooltip')}
                    </div>
                    <a
                      href={docLink('/plugins/schema-definition/trigger')}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      <div className='system-xs-regular inline-flex cursor-pointer items-center gap-1 text-text-accent'>
                        <RiBookOpenLine className='h-3 w-3' />
                        {t('pluginTrigger.subscription.list.tooltip.viewDocument')}
                      </div>
                    </a>
                  </div>
                }
              />
            </div>
            <div className='relative'>
              <ActionButton onClick={showAddDropdown}>
                <RiAddLine className='h-4 w-4' />
              </ActionButton>
              {isShowAddDropdown && (
                <AddTypeDropdown
                  onSelect={handleAddTypeSelect}
                  onClose={hideAddDropdown}
                  position='right'
                />
              )}
            </div>
          </div>

          <div className='flex flex-col gap-2'>
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
