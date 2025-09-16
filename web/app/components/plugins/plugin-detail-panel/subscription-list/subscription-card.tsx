'use client'
import ActionButton from '@/app/components/base/action-button'
import Confirm from '@/app/components/base/confirm'
import Toast from '@/app/components/base/toast'
import Indicator from '@/app/components/header/indicator'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { useDeleteTriggerSubscription } from '@/service/use-triggers'
import cn from '@/utils/classnames'
import {
  RiDeleteBinLine,
  RiWebhookLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { usePluginSubscriptionStore } from '../store'

type Props = {
  data: TriggerSubscription
}

const SubscriptionCard = ({ data }: Props) => {
  const { t } = useTranslation()
  const [isShowDeleteModal, {
    setTrue: showDeleteModal,
    setFalse: hideDeleteModal,
  }] = useBoolean(false)
  const { refresh } = usePluginSubscriptionStore()

  const { mutate: deleteSubscription, isPending: isDeleting } = useDeleteTriggerSubscription()

  const handleDelete = () => {
    deleteSubscription(data.id, {
      onSuccess: () => {
        Toast.notify({
          type: 'success',
          message: t('pluginTrigger.subscription.list.item.actions.deleteConfirm.title'),
        })
        refresh?.()
        hideDeleteModal()
      },
      onError: (error: any) => {
        Toast.notify({
          type: 'error',
          message: error?.message || 'Failed to delete subscription',
        })
      },
    })
  }

  const isActive = data.properties?.active !== false

  return (
    <>
      <div
        className={cn(
          'group relative cursor-pointer rounded-lg border-[0.5px] px-4 py-3 shadow-xs transition-all',
          'border-components-panel-border-subtle bg-components-panel-on-panel-item-bg',
          'hover:bg-components-panel-on-panel-item-bg-hover',
          'has-[.subscription-delete-btn:hover]:!border-state-destructive-border has-[.subscription-delete-btn:hover]:!bg-state-destructive-hover',
        )}
      >
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-1'>
            <RiWebhookLine className='h-4 w-4 text-text-secondary' />
            <span className='system-md-semibold text-text-secondary'>
              {data.name}
            </span>
          </div>

          <div className='flex h-[26px] w-6 items-center justify-center group-hover:hidden'>
            <Indicator
              color={isActive ? 'green' : 'red'}
              className=''
            />
          </div>

          <div className='hidden group-hover:block'>
            <ActionButton
              onClick={showDeleteModal}
              className='subscription-delete-btn transition-colors hover:bg-state-destructive-hover hover:text-text-destructive'
            >
              <RiDeleteBinLine className='h-4 w-4' />
            </ActionButton>
          </div>
        </div>

        <div className='mt-1 flex items-center justify-between'>
          <div className='system-xs-regular flex-1 truncate text-text-tertiary'>
            {data.endpoint}
          </div>
          <div className="mx-2 text-xs text-text-tertiary opacity-30">·</div>
          <div className='system-xs-regular shrink-0 text-text-tertiary'>
            {data.workflows_in_use > 0 ? t('pluginTrigger.subscription.list.item.usedByNum', { num: data.workflows_in_use }) : t('pluginTrigger.subscription.list.item.noUsed')}
          </div>
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
