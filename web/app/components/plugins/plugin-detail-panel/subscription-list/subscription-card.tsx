'use client'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { cn } from '@/utils/classnames'
import {
  RiDeleteBinLine,
  RiWebhookLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { DeleteConfirm } from './delete-confirm'

type Props = {
  data: TriggerSubscription
}

const SubscriptionCard = ({ data }: Props) => {
  const { t } = useTranslation()
  const [isShowDeleteModal, {
    setTrue: showDeleteModal,
    setFalse: hideDeleteModal,
  }] = useBoolean(false)

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
          <div className='flex h-6 items-center gap-1'>
            <RiWebhookLine className='h-4 w-4 text-text-secondary' />
            <span className='system-md-semibold text-text-secondary'>
              {data.name}
            </span>
          </div>

          <ActionButton
            onClick={showDeleteModal}
            className='subscription-delete-btn hidden transition-colors hover:bg-state-destructive-hover hover:text-text-destructive group-hover:block'
          >
            <RiDeleteBinLine className='h-4 w-4' />
          </ActionButton>
        </div>

        <div className='mt-1 flex items-center justify-between'>
          <Tooltip
            disabled={!data.endpoint}
            popupContent={data.endpoint && (
              <div className='max-w-[320px] break-all'>
                {data.endpoint}
              </div>
            )}
            position='left'
          >
            <div className='system-xs-regular flex-1 truncate text-text-tertiary'>
              {data.endpoint}
            </div>
          </Tooltip>
          <div className="mx-2 text-xs text-text-tertiary opacity-30">·</div>
          <div className='system-xs-regular shrink-0 text-text-tertiary'>
            {data.workflows_in_use > 0 ? t('pluginTrigger.subscription.list.item.usedByNum', { num: data.workflows_in_use }) : t('pluginTrigger.subscription.list.item.noUsed')}
          </div>
        </div>
      </div>

      {isShowDeleteModal && (
        <DeleteConfirm
          onClose={hideDeleteModal}
          isShow={isShowDeleteModal}
          currentId={data.id}
          currentName={data.name}
          workflowsInUse={data.workflows_in_use}
        />
      )}
    </>
  )
}

export default SubscriptionCard
