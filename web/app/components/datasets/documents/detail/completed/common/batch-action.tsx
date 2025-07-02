import React, { type FC } from 'react'
import { RiArchive2Line, RiCheckboxCircleLine, RiCloseCircleLine, RiDeleteBinLine, RiDraftLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import Divider from '@/app/components/base/divider'
import cn from '@/utils/classnames'
import Confirm from '@/app/components/base/confirm'
import Button from '@/app/components/base/button'

const i18nPrefix = 'dataset.batchAction'
type IBatchActionProps = {
  className?: string
  selectedIds: string[]
  onBatchEnable: () => void
  onBatchDisable: () => void
  onBatchDelete: () => Promise<void>
  onArchive?: () => void
  onEditMetadata?: () => void
  onCancel: () => void
}

const BatchAction: FC<IBatchActionProps> = ({
  className,
  selectedIds,
  onBatchEnable,
  onBatchDisable,
  onArchive,
  onBatchDelete,
  onEditMetadata,
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
    <div className={cn('flex w-full justify-center gap-x-2', className)}>
      <div className='flex items-center gap-x-1 rounded-[10px] border border-components-actionbar-border-accent bg-components-actionbar-bg-accent p-1 shadow-xl shadow-shadow-shadow-5'>
        <div className='inline-flex items-center gap-x-2 py-1 pl-2 pr-3'>
          <span className='system-xs-medium flex h-5 w-5 items-center justify-center rounded-md bg-text-accent text-text-primary-on-surface'>
            {selectedIds.length}
          </span>
          <span className='system-sm-semibold text-text-accent'>{t(`${i18nPrefix}.selected`)}</span>
        </div>
        <Divider type='vertical' className='mx-0.5 h-3.5 bg-divider-regular' />
        <Button
          variant='ghost'
          className='gap-x-0.5 px-3'
          onClick={onBatchEnable}
        >
          <RiCheckboxCircleLine className='size-4' />
          <span className='px-0.5'>{t(`${i18nPrefix}.enable`)}</span>
        </Button>
        <Button
          variant='ghost'
          className='gap-x-0.5 px-3'
          onClick={onBatchDisable}
        >
          <RiCloseCircleLine className='size-4' />
          <span className='px-0.5'>{t(`${i18nPrefix}.disable`)}</span>
        </Button>
        {onEditMetadata && (
          <Button
            variant='ghost'
            className='gap-x-0.5 px-3'
            onClick={onEditMetadata}
          >
            <RiDraftLine className='size-4' />
            <span className='px-0.5'>{t('dataset.metadata.metadata')}</span>
          </Button>
        )}

        {onArchive && (
          <Button
            variant='ghost'
            className='gap-x-0.5 px-3'
            onClick={onArchive}
          >
            <RiArchive2Line className='size-4' />
            <span className='px-0.5'>{t(`${i18nPrefix}.archive`)}</span>
          </Button>
        )}
        <Button
          variant='ghost'
          destructive
          className='gap-x-0.5 px-3'
          onClick={showDeleteConfirm}
        >
          <RiDeleteBinLine className='size-4' />
          <span className='px-0.5'>{t(`${i18nPrefix}.delete`)}</span>
        </Button>

        <Divider type='vertical' className='mx-0.5 h-3.5 bg-divider-regular' />
        <Button
          variant='ghost'
          className='px-3'
          onClick={onCancel}
        >
          <span className='px-0.5'>{t(`${i18nPrefix}.cancel`)}</span>
        </Button>
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
