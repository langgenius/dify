import React, { type FC } from 'react'
import { RiArchive2Line, RiCheckboxCircleLine, RiCloseCircleLine, RiDeleteBinLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import Divider from '@/app/components/base/divider'
import classNames from '@/utils/classnames'
import Confirm from '@/app/components/base/confirm'

const i18nPrefix = 'dataset.batchAction'
type IBatchActionProps = {
  className?: string
  selectedIds: string[]
  onBatchEnable: () => void
  onBatchDisable: () => void
  onBatchDelete: () => Promise<void>
  onArchive?: () => void
  onCancel: () => void
}

const BatchAction: FC<IBatchActionProps> = ({
  className,
  selectedIds,
  onBatchEnable,
  onBatchDisable,
  onArchive,
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
  }] = useBoolean(false)

  const handleBatchDelete = async () => {
    setIsDeleting()
    await onBatchDelete()
    hideDeleteConfirm()
  }
  return (
    <div className={classNames('w-full flex justify-center gap-x-2', className)}>
      <div className='bg-components-actionbar-bg-accent border-components-actionbar-border-accent shadow-shadow-shadow-5 flex items-center gap-x-1 rounded-[10px] border p-1 shadow-xl backdrop-blur-[5px]'>
        <div className='inline-flex items-center gap-x-2 py-1 pl-2 pr-3'>
          <span className='bg-text-accent text-text-primary-on-surface flex h-5 w-5 items-center justify-center rounded-md px-1 py-0.5 text-xs font-medium'>
            {selectedIds.length}
          </span>
          <span className='text-text-accent text-[13px] font-semibold leading-[16px]'>{t(`${i18nPrefix}.selected`)}</span>
        </div>
        <Divider type='vertical' className='bg-divider-regular mx-0.5 h-3.5' />
        <div className='flex items-center gap-x-0.5 px-3 py-2'>
          <RiCheckboxCircleLine className='text-components-button-ghost-text h-4 w-4' />
          <button type='button' className='text-components-button-ghost-text px-0.5 text-[13px] font-medium leading-[16px]' onClick={onBatchEnable}>
            {t(`${i18nPrefix}.enable`)}
          </button>
        </div>
        <div className='flex items-center gap-x-0.5 px-3 py-2'>
          <RiCloseCircleLine className='text-components-button-ghost-text h-4 w-4' />
          <button type='button' className='text-components-button-ghost-text px-0.5 text-[13px] font-medium leading-[16px]' onClick={onBatchDisable}>
            {t(`${i18nPrefix}.disable`)}
          </button>
        </div>
        {onArchive && (
          <div className='flex items-center gap-x-0.5 px-3 py-2'>
            <RiArchive2Line className='text-components-button-ghost-text h-4 w-4' />
            <button type='button' className='text-components-button-ghost-text px-0.5 text-[13px] font-medium leading-[16px]' onClick={onArchive}>
              {t(`${i18nPrefix}.archive`)}
            </button>
          </div>
        )}
        <div className='flex items-center gap-x-0.5 px-3 py-2'>
          <RiDeleteBinLine className='text-components-button-destructive-ghost-text h-4 w-4' />
          <button type='button' className='text-components-button-destructive-ghost-text px-0.5 text-[13px] font-medium leading-[16px]' onClick={showDeleteConfirm}>
            {t(`${i18nPrefix}.delete`)}
          </button>
        </div>

        <Divider type='vertical' className='bg-divider-regular mx-0.5 h-3.5' />
        <button type='button' className='text-components-button-ghost-text px-3.5 py-2 text-[13px] font-medium leading-[16px]' onClick={onCancel}>
          {t(`${i18nPrefix}.cancel`)}
        </button>
      </div>
      {
        isShowDeleteConfirm && (
          <Confirm
            isShow
            title={t('datasetDocuments.list.delete.title')}
            content={t('datasetDocuments.list.delete.content')}
            confirmText={t('common.operation.sure')}
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
