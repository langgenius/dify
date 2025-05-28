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
            <td className='w-5 whitespace-nowrap rounded-l-lg bg-background-section-burn pl-2 pr-1'>{t('appAnnotation.table.header.question')}</td>
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
    </div>
  )
}
export default React.memo(List)
