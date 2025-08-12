'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import type { AnnotationItem } from './type'
import RemoveAnnotationConfirmModal from './remove-annotation-confirm-modal'
import ActionButton from '@/app/components/base/action-button'
import useTimestamp from '@/hooks/use-timestamp'
import cn from '@/utils/classnames'
import Checkbox from '@/app/components/base/checkbox'
import BatchAction from './batch-action'

type Props = {
  list: AnnotationItem[]
  onView: (item: AnnotationItem) => void
  onRemove: (id: string) => void
  selectedIds: string[]
  onSelectedIdsChange: (selectedIds: string[]) => void
  onBatchDelete: () => Promise<void>
  onCancel: () => void
  isBatchDeleting?: boolean
}

const List: FC<Props> = ({
  list,
  onView,
  onRemove,
  selectedIds,
  onSelectedIdsChange,
  onBatchDelete,
  onCancel,
  isBatchDeleting,
}) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const [currId, setCurrId] = React.useState<string | null>(null)
  const [showConfirmDelete, setShowConfirmDelete] = React.useState(false)

  const isAllSelected = useMemo(() => {
    return list.length > 0 && list.every(item => selectedIds.includes(item.id))
  }, [list, selectedIds])

  const isSomeSelected = useMemo(() => {
    return list.some(item => selectedIds.includes(item.id))
  }, [list, selectedIds])

  const handleSelectAll = useCallback(() => {
    const currentPageIds = list.map(item => item.id)
    const otherPageIds = selectedIds.filter(id => !currentPageIds.includes(id))

    if (isAllSelected)
      onSelectedIdsChange(otherPageIds)
    else
      onSelectedIdsChange([...otherPageIds, ...currentPageIds])
  }, [isAllSelected, list, selectedIds, onSelectedIdsChange])

  return (
    <div className='relative grow overflow-x-auto'>
      <table className={cn('mt-2 w-full min-w-[440px] border-collapse border-0')}>
        <thead className='system-xs-medium-uppercase text-text-tertiary'>
          <tr>
            <td className='w-12 whitespace-nowrap rounded-l-lg bg-background-section-burn px-2'>
              <Checkbox
                className='mr-2'
                checked={isAllSelected}
                indeterminate={!isAllSelected && isSomeSelected}
                onCheck={handleSelectAll}
              />
            </td>
            <td className='w-5 whitespace-nowrap bg-background-section-burn pl-2 pr-1'>{t('appAnnotation.table.header.question')}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t('appAnnotation.table.header.answer')}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t('appAnnotation.table.header.createdAt')}</td>
            <td className='whitespace-nowrap bg-background-section-burn py-1.5 pl-3'>{t('appAnnotation.table.header.hits')}</td>
            <td className='w-[96px] whitespace-nowrap rounded-r-lg bg-background-section-burn py-1.5 pl-3'>{t('appAnnotation.table.header.actions')}</td>
          </tr>
        </thead>
        <tbody className="system-sm-regular text-text-secondary">
          {list.map(item => (
            <tr
              key={item.id}
              className='cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover'
              onClick={
                () => {
                  onView(item)
                }
              }
            >
              <td className='w-12 px-2' onClick={e => e.stopPropagation()}>
                <Checkbox
                  className='mr-2'
                  checked={selectedIds.includes(item.id)}
                  onCheck={() => {
                    if (selectedIds.includes(item.id))
                      onSelectedIdsChange(selectedIds.filter(id => id !== item.id))
                    else
                      onSelectedIdsChange([...selectedIds, item.id])
                  }}
                />
              </td>
              <td
                className='max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap p-3 pr-2'
                title={item.question}
              >{item.question}</td>
              <td
                className='max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap p-3 pr-2'
                title={item.answer}
              >{item.answer}</td>
              <td className='p-3 pr-2'>{formatTime(item.created_at, t('appLog.dateTimeFormat') as string)}</td>
              <td className='p-3 pr-2'>{item.hit_count}</td>
              <td className='w-[96px] p-3 pr-2' onClick={e => e.stopPropagation()}>
                {/* Actions */}
                <div className='flex space-x-1 text-text-tertiary'>
                  <ActionButton onClick={() => onView(item)}>
                    <RiEditLine className='h-4 w-4' />
                  </ActionButton>
                  <ActionButton
                    onClick={() => {
                      setCurrId(item.id)
                      setShowConfirmDelete(true)
                    }}
                  >
                    <RiDeleteBinLine className='h-4 w-4' />
                  </ActionButton>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <RemoveAnnotationConfirmModal
        isShow={showConfirmDelete}
        onHide={() => setShowConfirmDelete(false)}
        onRemove={() => {
          onRemove(currId as string)
          setShowConfirmDelete(false)
        }}
      />
      {selectedIds.length > 0 && (
        <BatchAction
          className='absolute bottom-6 left-1/2 z-20 -translate-x-1/2'
          selectedIds={selectedIds}
          onBatchDelete={onBatchDelete}
          onCancel={onCancel}
          isBatchDeleting={isBatchDeleting}
        />
      )}
    </div>
  )
}
export default React.memo(List)
