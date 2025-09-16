'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import SubscriptionCard from './subscription-card'
import { SubscriptionCreateModal } from './subscription-create-modal'
import { CreateTypeDropdown } from './create/create-type-dropdown'
import CreateSubscriptionButton, { ButtonType, DEFAULT_METHOD } from './create-subscription-button'
import Tooltip from '@/app/components/base/tooltip'
import { useTriggerOAuthConfig, useTriggerProviderInfo, useTriggerSubscriptions } from '@/service/use-triggers'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import cn from '@/utils/classnames'
import { usePluginStore } from '../store'

export const SubscriptionList = () => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)

  const showTopBorder = detail?.declaration.tool || detail?.declaration.endpoint
  const provider = `${detail?.plugin_id}/${detail?.declaration.name}`

  const { data: subscriptions, isLoading, refetch } = useTriggerSubscriptions(provider)
  const { data: providerInfo } = useTriggerProviderInfo(provider)
  const { data: oauthConfig } = useTriggerOAuthConfig(provider, providerInfo?.supported_creation_methods.includes(SupportedCreationMethods.OAUTH))

  const [isShowCreateDropdown, {
    setTrue: showCreateDropdown,
    setFalse: hideCreateDropdown,
  }] = useBoolean(false)

  const [selectedCreateType, setSelectedCreateType] = React.useState<SupportedCreationMethods | null>(null)

  const [isShowCreateModal, {
    setTrue: showCreateModal,
    setFalse: hideCreateModal,
  }] = useBoolean(false)

  const handleCreateSubscription = (type?: SupportedCreationMethods | typeof DEFAULT_METHOD) => {
    if (type === DEFAULT_METHOD) {
      showCreateDropdown()
      return
    }
    setSelectedCreateType(type as SupportedCreationMethods)
    showCreateModal()
  }

  const handleCreateTypeSelect = (type: SupportedCreationMethods) => {
    setSelectedCreateType(type)
    hideCreateDropdown()
    showCreateModal()
  }

  const handleModalClose = () => {
    hideCreateModal()
    setSelectedCreateType(null)
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
          <CreateSubscriptionButton
            supportedMethods={providerInfo?.supported_creation_methods || []}
            onClick={handleCreateSubscription}
            className='w-full'
            oauthConfig={oauthConfig}
          />
          {isShowCreateDropdown && (
            <CreateTypeDropdown
              onSelect={handleCreateTypeSelect}
              onClose={hideCreateDropdown}
              supportedMethods={providerInfo?.supported_creation_methods || []}
              oauthConfig={oauthConfig}
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
            <CreateSubscriptionButton
              supportedMethods={providerInfo?.supported_creation_methods || []}
              onClick={handleCreateSubscription}
              buttonType={ButtonType.ICON_BUTTON}
              oauthConfig={oauthConfig}
            />
            {isShowCreateDropdown && (
              <CreateTypeDropdown
                onSelect={handleCreateTypeSelect}
                onClose={hideCreateDropdown}
                supportedMethods={providerInfo?.supported_creation_methods || []}
                oauthConfig={oauthConfig}
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

      {isShowCreateModal && selectedCreateType && (
        <SubscriptionCreateModal
          type={selectedCreateType}
          oauthConfig={oauthConfig}
          onClose={handleModalClose}
          onSuccess={handleRefreshList}
        />
      )}
    </div>
  )
}
