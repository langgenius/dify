import type { FC } from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import Divider from '@/app/components/base/divider'
import { cn } from '@/utils/classnames'

const i18nPrefix = 'batchAction'

type IBatchActionProps = {
  className?: string
  selectedIds: string[]
  onBatchDelete: () => Promise<void>
  onCancel: () => void
}

const BatchAction: FC<IBatchActionProps> = ({
  className,
  selectedIds,
  onBatchDelete,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [isShowDeleteConfirm, {
    setTrue: showDeleteConfirm,
    setFalse: hideDeleteConfirm,
  }] = useBoolean(false)
  const [isDeleting, {
    setTrue: setIsDeleting,
    setFalse: setIsNotDeleting,
  }] = useBoolean(false)

  const handleBatchDelete = async () => {
    setIsDeleting()
    await onBatchDelete()
    hideDeleteConfirm()
    setIsNotDeleting()
  }
  return (
    <div className={cn('pointer-events-none flex w-full justify-center', className)}>
      <div className="pointer-events-auto flex items-center gap-x-1 rounded-[10px] border border-components-actionbar-border-accent bg-components-actionbar-bg-accent p-1 shadow-xl shadow-shadow-shadow-5 backdrop-blur-[5px]">
        <div className="inline-flex items-center gap-x-2 py-1 pl-2 pr-3">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-text-accent px-1 py-0.5 text-xs font-medium text-text-primary-on-surface">
            {selectedIds.length}
          </span>
          <span className="text-[13px] font-semibold leading-[16px] text-text-accent">{t(`${i18nPrefix}.selected`, { ns: 'appAnnotation' })}</span>
        </div>
        <Divider type="vertical" className="mx-0.5 h-3.5 bg-divider-regular" />
        <div className="flex cursor-pointer items-center gap-x-0.5 px-3 py-2" onClick={showDeleteConfirm}>
          <RiDeleteBinLine className="h-4 w-4 text-components-button-destructive-ghost-text" />
          <button type="button" className="px-0.5 text-[13px] font-medium leading-[16px] text-components-button-destructive-ghost-text">
            {t('operation.delete', { ns: 'common' })}
          </button>
        </div>

        <Divider type="vertical" className="mx-0.5 h-3.5 bg-divider-regular" />
        <button type="button" className="px-3.5 py-2 text-[13px] font-medium leading-[16px] text-components-button-ghost-text" onClick={onCancel}>
          {t('operation.cancel', { ns: 'common' })}
        </button>
      </div>
      {
        isShowDeleteConfirm && (
          <Confirm
            isShow
            title={t('list.delete.title', { ns: 'appAnnotation' })}
            confirmText={t('operation.delete', { ns: 'common' })}
            onConfirm={handleBatchDelete}
            onCancel={hideDeleteConfirm}
            isLoading={isDeleting}
            isDisabled={isDeleting}
          />
        )
      }
    </div>
  )
}

export default React.memo(BatchAction)
