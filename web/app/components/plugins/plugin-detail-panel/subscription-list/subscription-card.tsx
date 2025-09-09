'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import {
  RiDeleteBinLine,
  RiGitBranchLine,
  RiKeyLine,
  RiUserLine,
  RiWebhookLine,
} from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
import Confirm from '@/app/components/base/confirm'
import Toast from '@/app/components/base/toast'
import { useDeleteTriggerSubscription } from '@/service/use-triggers'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import cn from '@/utils/classnames'

type Props = {
  data: TriggerSubscription
  onRefresh: () => void
}

const getProviderIcon = (provider: string) => {
  switch (provider) {
    case 'github':
      return <RiGitBranchLine className='h-4 w-4' />
    case 'gitlab':
      return <RiGitBranchLine className='h-4 w-4' />
    default:
      return <RiWebhookLine className='h-4 w-4' />
  }
}

const getCredentialIcon = (credentialType: string) => {
  switch (credentialType) {
    case 'oauth2':
      return <RiUserLine className='h-4 w-4 text-text-accent' />
    case 'api_key':
      return <RiKeyLine className='h-4 w-4 text-text-warning' />
    case 'unauthorized':
      return <RiWebhookLine className='h-4 w-4 text-text-secondary' />
    default:
      return <RiWebhookLine className='h-4 w-4' />
  }
}

const SubscriptionCard = ({ data, onRefresh }: Props) => {
  const { t } = useTranslation()
  const [isHovered, setIsHovered] = useState(false)
  const [isShowDeleteModal, {
    setTrue: showDeleteModal,
    setFalse: hideDeleteModal,
  }] = useBoolean(false)

  // API mutations
  const { mutate: deleteSubscription, isPending: isDeleting } = useDeleteTriggerSubscription()

  const handleDelete = () => {
    deleteSubscription(data.id, {
      onSuccess: () => {
        Toast.notify({
          type: 'success',
          message: t('pluginTrigger.subscription.list.item.actions.deleteConfirm.title'),
        })
        onRefresh()
        hideDeleteModal()
      },
      onError: (error: any) => {
        Toast.notify({
          type: 'error',
          message: error?.message || 'Failed to delete subscription',
        })
        hideDeleteModal()
      },
    })
  }

  // Determine if subscription is active/enabled based on properties
  const isActive = data.properties?.active !== false

  return (
    <>
      <div
        className={cn(
          'group relative flex items-center justify-between rounded-lg border-[0.5px] p-3 transition-all',
          'hover:border-components-panel-border hover:bg-background-default-hover',
          isActive
            ? 'bg-components-panel-on-panel-item border-components-panel-border-subtle'
            : 'bg-components-panel-on-panel-item-disabled border-components-panel-border-subtle opacity-60',
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className='flex items-center gap-3'>
          <div className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg border-[0.5px]',
            isActive
              ? 'border-components-panel-border-subtle bg-background-default-subtle text-text-secondary'
              : 'bg-background-default-disabled border-components-panel-border-subtle text-text-quaternary',
          )}>
            {getProviderIcon(data.provider)}
          </div>
          <div className='flex flex-col'>
            <div className='flex items-center gap-2'>
              <span className={cn(
                'system-sm-medium',
                isActive ? 'text-text-primary' : 'text-text-tertiary',
              )}>
                {data.name}
              </span>
              {getCredentialIcon(data.credential_type)}
            </div>
            <div className={cn(
              'system-xs-regular flex items-center gap-2',
              isActive ? 'text-text-tertiary' : 'text-text-quaternary',
            )}>
              <span>{data.provider}</span>
              <span>•</span>
              <span className={cn(
                'rounded px-2 py-0.5 text-xs font-medium',
                isActive
                  ? 'bg-state-success-bg text-state-success-text'
                  : 'bg-background-default-subtle text-text-quaternary',
              )}>
                {isActive
                  ? t('pluginTrigger.subscription.list.item.status.active')
                  : t('pluginTrigger.subscription.list.item.status.inactive')
                }
              </span>
            </div>
          </div>
        </div>

        {/* Delete button - only show on hover */}
        <div className={cn(
          'absolute right-3 top-1/2 -translate-y-1/2 transition-opacity',
          isHovered ? 'opacity-100' : 'opacity-0',
        )}>
          <ActionButton
            onClick={showDeleteModal}
            className='hover:text-state-destructive-text hover:bg-state-destructive-hover'
          >
            <RiDeleteBinLine className='h-4 w-4' />
          </ActionButton>
        </div>
      </div>

      {isShowDeleteModal && (
        <Confirm
          title={t('pluginTrigger.subscription.list.item.actions.deleteConfirm.title')}
          content={t('pluginTrigger.subscription.list.item.actions.deleteConfirm.content', { name: data.name })}
          isShow={isShowDeleteModal}
          onConfirm={handleDelete}
          onCancel={hideDeleteModal}
          isLoading={isDeleting}
        />
      )}
    </>
  )
}

export default SubscriptionCard
