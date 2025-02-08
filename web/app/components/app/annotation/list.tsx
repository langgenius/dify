'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import type { AnnotationItem } from './type'
import RemoveAnnotationConfirmModal from './remove-annotation-confirm-modal'
import ActionButton from '@/app/components/base/action-button'
import useTimestamp from '@/hooks/use-timestamp'
import cn from '@/utils/classnames'

type Props = {
  list: AnnotationItem[]
  onRemove: (id: string) => void
  onView: (item: AnnotationItem) => void
}

const List: FC<Props> = ({
  list,
  onView,
  onRemove,
}) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const [currId, setCurrId] = React.useState<string | null>(null)
  const [showConfirmDelete, setShowConfirmDelete] = React.useState(false)
  return (
    <div className='overflow-x-auto'>
      <table className={cn('mt-2 w-full min-w-[440px] border-collapse border-0')}>
        <thead className='system-xs-medium-uppercase text-text-tertiary'>
          <tr>
            <td className='pl-2 pr-1 w-5 rounded-l-lg bg-background-section-burn whitespace-nowrap'>{t('appAnnotation.table.header.question')}</td>
            <td className='pl-3 py-1.5 bg-background-section-burn whitespace-nowrap'>{t('appAnnotation.table.header.answer')}</td>
            <td className='pl-3 py-1.5 bg-background-section-burn whitespace-nowrap'>{t('appAnnotation.table.header.createdAt')}</td>
            <td className='pl-3 py-1.5 bg-background-section-burn whitespace-nowrap'>{t('appAnnotation.table.header.hits')}</td>
            <td className='pl-3 py-1.5 rounded-r-lg bg-background-section-burn whitespace-nowrap w-[96px]'>{t('appAnnotation.table.header.actions')}</td>
          </tr>
        </thead>
        <tbody className="text-text-secondary system-sm-regular">
          {list.map(item => (
            <tr
              key={item.id}
              className='border-b border-divider-subtle hover:bg-background-default-hover cursor-pointer'
              onClick={
                () => {
                  onView(item)
                }
              }
            >
              <td
                className='p-3 pr-2 whitespace-nowrap overflow-hidden text-ellipsis max-w-[250px]'
                title={item.question}
              >{item.question}</td>
              <td
                className='p-3 pr-2 whitespace-nowrap overflow-hidden text-ellipsis max-w-[250px]'
                title={item.answer}
              >{item.answer}</td>
              <td className='p-3 pr-2'>{formatTime(item.created_at, t('appLog.dateTimeFormat') as string)}</td>
              <td className='p-3 pr-2'>{item.hit_count}</td>
              <td className='w-[96px] p-3 pr-2' onClick={e => e.stopPropagation()}>
                {/* Actions */}
                <div className='flex space-x-1 text-text-tertiary'>
                  <ActionButton onClick={() => onView(item)}>
                    <RiEditLine className='w-4 h-4' />
                  </ActionButton>
                  <ActionButton
                    onClick={() => {
                      setCurrId(item.id)
                      setShowConfirmDelete(true)
                    }}
                  >
                    <RiDeleteBinLine className='w-4 h-4' />
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
    </div>
  )
}
export default React.memo(List)
