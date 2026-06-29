'use client'
import type { AnnotationItem } from './type'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import * as React from 'react'
import { useTranslation } from '#i18n'
import ActionButton from '@/app/components/base/action-button'
import useTimestamp from '@/hooks/use-timestamp'
import BatchAction from './batch-action'
import RemoveAnnotationConfirmModal from './remove-annotation-confirm-modal'

type Props = Readonly<{
  list: AnnotationItem[]
  onView: (item: AnnotationItem) => void
  onRemove: (id: string) => void
  selectedIds: string[]
  onSelectedIdsChange: (selectedIds: string[]) => void
  onBatchDelete: () => Promise<void>
}>

type AnnotationTableRowProps = {
  item: AnnotationItem
  formattedCreatedAt: string
  onView: (item: AnnotationItem) => void
  onRemoveClick: (id: string) => void
}

function AnnotationTableRow({
  item,
  formattedCreatedAt,
  onView,
  onRemoveClick,
}: AnnotationTableRowProps) {
  const { t } = useTranslation()
  const questionId = React.useId()

  return (
    <tr
      className="cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover"
      onClick={() => onView(item)}
    >
      <td className="w-12 px-2 align-middle" onClick={e => e.stopPropagation()}>
        <div className="flex items-center">
          <Checkbox
            className="shrink-0"
            value={item.id}
            aria-labelledby={questionId}
          />
        </div>
      </td>
      <td
        className="max-w-62.5 truncate p-3 pr-2"
        title={item.question}
      >
        <span id={questionId}>{item.question}</span>
      </td>
      <td
        className="max-w-62.5 truncate p-3 pr-2"
        title={item.answer}
      >
        {item.answer}
      </td>
      <td className="p-3 pr-2">{formattedCreatedAt}</td>
      <td className="p-3 pr-2">{item.hit_count}</td>
      <td className="w-24 p-3 pr-2" onClick={e => e.stopPropagation()}>
        <div className="flex space-x-1 text-text-tertiary">
          <ActionButton aria-label={t('feature.annotation.edit', { ns: 'appDebug' })} onClick={() => onView(item)}>
            <span aria-hidden className="i-ri-edit-line size-4" />
          </ActionButton>
          <ActionButton
            aria-label={t('feature.annotation.remove', { ns: 'appDebug' })}
            onClick={() => onRemoveClick(item.id)}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
          </ActionButton>
        </div>
      </td>
    </tr>
  )
}

export function List({
  list,
  onView,
  onRemove,
  selectedIds,
  onSelectedIdsChange,
  onBatchDelete,
}: Props) {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const [currId, setCurrId] = React.useState<string | null>(null)
  const [showConfirmDelete, setShowConfirmDelete] = React.useState(false)
  const annotationIds = list.map(item => item.id)

  return (
    <>
      <div className="relative mt-2 grow overflow-x-auto">
        <CheckboxGroup
          value={selectedIds}
          onValueChange={onSelectedIdsChange}
          allValues={annotationIds}
        >
          <table className="w-full min-w-110 border-collapse border-0">
            <thead className="system-xs-medium-uppercase text-text-tertiary">
              <tr>
                <td className="w-12 rounded-l-lg bg-background-section-burn px-2 align-middle whitespace-nowrap">
                  <div className="flex items-center">
                    <Checkbox
                      className="shrink-0"
                      parent
                      aria-label={t('operation.selectAll', { ns: 'common' })}
                    />
                  </div>
                </td>
                <td className="w-5 bg-background-section-burn pr-1 pl-2 whitespace-nowrap">{t('table.header.question', { ns: 'appAnnotation' })}</td>
                <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('table.header.answer', { ns: 'appAnnotation' })}</td>
                <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('table.header.createdAt', { ns: 'appAnnotation' })}</td>
                <td className="bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('table.header.hits', { ns: 'appAnnotation' })}</td>
                <td className="w-24 rounded-r-lg bg-background-section-burn py-1.5 pl-3 whitespace-nowrap">{t('table.header.actions', { ns: 'appAnnotation' })}</td>
              </tr>
            </thead>
            <tbody className="system-sm-regular text-text-secondary">
              {list.map(item => (
                <AnnotationTableRow
                  key={item.id}
                  item={item}
                  formattedCreatedAt={formatTime(item.created_at, t('dateTimeFormat', { ns: 'appLog' }) as string)}
                  onView={onView}
                  onRemoveClick={(id) => {
                    setCurrId(id)
                    setShowConfirmDelete(true)
                  }}
                />
              ))}
            </tbody>
          </table>
        </CheckboxGroup>
        <RemoveAnnotationConfirmModal
          isShow={showConfirmDelete}
          onHide={() => setShowConfirmDelete(false)}
          onRemove={() => {
            onRemove(currId as string)
            setShowConfirmDelete(false)
          }}
        />
      </div>
      {selectedIds.length > 0 && (
        <BatchAction
          className="absolute bottom-20 left-0 z-20"
          selectedIds={selectedIds}
          onBatchDelete={onBatchDelete}
          onSelectedIdsChange={onSelectedIdsChange}
        />
      )}
    </>
  )
}
