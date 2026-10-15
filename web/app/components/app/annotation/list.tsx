'use client'
import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import type { AnnotationItem } from './type'
import { AlertDialog, AlertDialogTrigger } from '@langgenius/dify-ui/alert-dialog'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/console'
import BatchAction from './batch-action'
import { RemoveAnnotationConfirmContent } from './remove-annotation-confirm-modal'

type Props = Readonly<{
  appId: string
  list: AnnotationItem[]
  onView: (item: AnnotationItem) => void
  onRemoved: () => void
  selectedIds: string[]
  onSelectedIdsChange: (selectedIds: string[]) => void
  onBatchDelete: () => Promise<void>
}>

type AnnotationTableRowProps = {
  appId: string
  item: AnnotationItem
  formattedCreatedAt: string
  onView: (item: AnnotationItem) => void
  onRemoved: () => void
}

function AnnotationTableRow({
  appId,
  item,
  formattedCreatedAt,
  onView,
  onRemoved,
}: AnnotationTableRowProps) {
  const { t } = useTranslation(['appDebug'])
  const questionId = React.useId()
  const removeConfirmActionsRef = React.useRef<AlertDialogActions>(null)
  const removeMutation = useMutation(
    consoleQuery.apps.byAppId.annotations.byAnnotationId.delete.mutationOptions({
      onSuccess: () => {
        removeConfirmActionsRef.current?.close()
        onRemoved()
      },
    }),
  )

  return (
    <tr
      className="cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover"
      onClick={() => onView(item)}
    >
      <td className="w-12 px-2 align-middle" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <Checkbox className="shrink-0" value={item.id} aria-labelledby={questionId} />
        </div>
      </td>
      <td className="max-w-62.5 truncate p-3 pr-2" title={item.question}>
        <span id={questionId}>{item.question}</span>
      </td>
      <td className="max-w-62.5 truncate p-3 pr-2" title={item.answer}>
        {item.answer}
      </td>
      <td className="p-3 pr-2">{formattedCreatedAt}</td>
      <td className="p-3 pr-2">{item.hit_count}</td>
      <td className="w-24 p-3 pr-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex space-x-1 text-text-tertiary">
          <IconButton
            aria-label={t(($) => $['feature.annotation.edit'], { ns: 'appDebug' })}
            onClick={() => onView(item)}
          >
            <span aria-hidden className="i-ri-edit-line size-4" />
          </IconButton>
          <AlertDialog
            actionsRef={removeConfirmActionsRef}
            onOpenChange={(open, details) => {
              if (!open && removeMutation.isPending && details.reason !== 'imperative-action')
                details.cancel()
            }}
          >
            <AlertDialogTrigger
              render={
                <IconButton
                  aria-label={t(($) => $['feature.annotation.remove'], { ns: 'appDebug' })}
                >
                  <span aria-hidden className="i-ri-delete-bin-line size-4" />
                </IconButton>
              }
            />
            <RemoveAnnotationConfirmContent
              isPending={removeMutation.isPending}
              onRemove={() =>
                removeMutation.mutate({ params: { app_id: appId, annotation_id: item.id } })
              }
            />
          </AlertDialog>
        </div>
      </td>
    </tr>
  )
}

export function List({
  appId,
  list,
  onView,
  onRemoved,
  selectedIds,
  onSelectedIdsChange,
  onBatchDelete,
}: Props) {
  const { t } = useTranslation(['appAnnotation', 'appLog', 'common'])
  const { formatTime } = useTimestamp()
  const annotationIds = list.map((item) => item.id)

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
                <th className="w-12 rounded-l-lg bg-background-section-burn px-2 text-left align-middle font-[weight:inherit] whitespace-nowrap">
                  <div className="flex items-center">
                    <Checkbox
                      className="shrink-0"
                      parent
                      aria-label={t(($) => $['operation.selectAll'], { ns: 'common' })}
                    />
                  </div>
                </th>
                <th className="w-5 bg-background-section-burn pr-1 pl-2 text-left font-[weight:inherit] whitespace-nowrap">
                  {t(($) => $['table.header.question'], { ns: 'appAnnotation' })}
                </th>
                <th className="bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                  {t(($) => $['table.header.answer'], { ns: 'appAnnotation' })}
                </th>
                <th className="bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                  {t(($) => $['table.header.createdAt'], { ns: 'appAnnotation' })}
                </th>
                <th className="bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                  {t(($) => $['table.header.hits'], { ns: 'appAnnotation' })}
                </th>
                <th className="w-24 rounded-r-lg bg-background-section-burn py-1.5 pl-3 text-left font-[weight:inherit] whitespace-nowrap">
                  {t(($) => $['table.header.actions'], { ns: 'appAnnotation' })}
                </th>
              </tr>
            </thead>
            <tbody className="system-sm-regular text-text-secondary">
              {list.map((item) => (
                <AnnotationTableRow
                  key={item.id}
                  item={item}
                  formattedCreatedAt={formatTime(
                    item.created_at,
                    t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
                  )}
                  appId={appId}
                  onView={onView}
                  onRemoved={onRemoved}
                />
              ))}
            </tbody>
          </table>
        </CheckboxGroup>
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
