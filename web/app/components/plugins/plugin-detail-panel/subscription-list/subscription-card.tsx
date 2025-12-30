'use client'
import type { PluginDetail } from '@/app/components/plugins/types'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiWebhookLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'
import { DeleteConfirm } from './delete-confirm'
import { EditModal } from './edit'

type Props = {
  data: TriggerSubscription
  pluginDetail?: PluginDetail
}

const SubscriptionCard = ({ data, pluginDetail }: Props) => {
  const { t } = useTranslation()
  const [isShowDeleteModal, {
    setTrue: showDeleteModal,
    setFalse: hideDeleteModal,
  }] = useBoolean(false)
  const [isShowEditModal, {
    setTrue: showEditModal,
    setFalse: hideEditModal,
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
        <div className="flex items-center justify-between">
          <div className="flex h-6 items-center gap-1">
            <RiWebhookLine className="h-4 w-4 text-text-secondary" />
            <span className="system-md-semibold text-text-secondary">
              {data.name}
            </span>
          </div>

          <div className="hidden items-center gap-1 group-hover:flex">
            <ActionButton
              onClick={showEditModal}
              className="transition-colors hover:bg-state-base-hover"
            >
              <RiEditLine className="h-4 w-4" />
            </ActionButton>
            <ActionButton
              onClick={showDeleteModal}
              className="subscription-delete-btn transition-colors hover:bg-state-destructive-hover hover:text-text-destructive"
            >
              <RiDeleteBinLine className="h-4 w-4" />
            </ActionButton>
          </div>
        </div>

        <div className="mt-1 flex items-center justify-between">
          <Tooltip
            disabled={!data.endpoint}
            popupContent={data.endpoint && (
              <div className="max-w-[320px] break-all">
                {data.endpoint}
              </div>
            )}
            position="left"
          >
            <div className="system-xs-regular flex-1 truncate text-text-tertiary">
              {data.endpoint}
            </div>
          </Tooltip>
          <div className="mx-2 text-xs text-text-tertiary opacity-30">·</div>
          <div className="system-xs-regular shrink-0 text-text-tertiary">
            {data.workflows_in_use > 0 ? t('subscription.list.item.usedByNum', { ns: 'pluginTrigger', num: data.workflows_in_use }) : t('subscription.list.item.noUsed', { ns: 'pluginTrigger' })}
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

      {isShowEditModal && (
        <EditModal
          onClose={hideEditModal}
          subscription={data}
          pluginDetail={pluginDetail}
        />
      )}
    </>
  )
}

export default SubscriptionCard
