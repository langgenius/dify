'use client'
import type { Annotation } from '@dify/contracts/api/console/apps/types.gen'
import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import { AlertDialog, AlertDialogTrigger } from '@langgenius/dify-ui/alert-dialog'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/console'
import BatchAction from './batch-action'
import EmptyElement from './empty-element'
import { RemoveAnnotationConfirmContent } from './remove-annotation-confirm-modal'
import AnnotationDetails from './view-annotation-modal'

type AnnotationTableRowProps = {
  appId: string
  item: Annotation
  formattedCreatedAt: string
  onRemoved: () => void
}

function AnnotationTableRow({
  appId,
  item,
  formattedCreatedAt,
  onRemoved,
}: AnnotationTableRowProps) {
  const { t } = useTranslation(['appDebug'])
  const questionId = useId()
  const editTriggerRef = useRef<HTMLButtonElement>(null)
  const removeConfirmActionsRef = useRef<AlertDialogActions>(null)
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
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('button, input, [role="checkbox"]'))
          editTriggerRef.current?.click()
      }}
    >
      <td className="w-12 px-2 align-middle" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <Checkbox className="shrink-0" value={item.id} aria-labelledby={questionId} />
        </div>
      </td>
      <td className="max-w-62.5 truncate p-3 pe-2" title={item.question ?? undefined}>
        <DialogTrigger payload={item} id={questionId} className="max-w-full truncate text-start">
          {item.question}
        </DialogTrigger>
      </td>
      <td className="max-w-62.5 truncate p-3 pe-2" title={item.answer ?? undefined}>
        {item.answer}
      </td>
      <td className="p-3 pe-2">{formattedCreatedAt}</td>
      <td className="p-3 pe-2">{item.hit_count}</td>
      <td className="w-24 p-3 pe-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex space-x-1 text-text-tertiary">
          <DialogTrigger
            payload={item}
            ref={editTriggerRef}
            render={
              <IconButton aria-label={t(($) => $['feature.annotation.edit'], { ns: 'appDebug' })}>
                <span aria-hidden className="i-ri-edit-line size-4" />
              </IconButton>
            }
          >
            <span aria-hidden className="i-ri-edit-line size-4" />
          </DialogTrigger>
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

type AnnotationListProps = {
  isLoading?: boolean
  appId: string
  list: Annotation[]
  onEdited: () => void
  onRemoved: () => void
  selectedIds: string[]
  onSelectedIdsChange: (selectedIds: string[]) => void
  onBatchDelete: () => Promise<void>
}

export function List({
  isLoading = false,
  appId,
  list,
  onEdited,
  onRemoved,
  selectedIds,
  onSelectedIdsChange,
  onBatchDelete,
}: AnnotationListProps) {
  const { t } = useTranslation(['appAnnotation', 'appLog', 'common'])
  const { formatTime } = useTimestamp()
  const annotationIds = list.map((item) => item.id)
  const actionsRef = useRef<DialogActions>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)
  const removed = useRef(false)
  const removalFocus = useRef<HTMLElement | null>(null)
  const update = useMutation(
    consoleQuery.apps.byAppId.annotations.byAnnotationId.post.mutationOptions({
      context: { silent: true },
      onSuccess: onEdited,
    }),
  )

  return (
    <Dialog<Annotation>
      actionsRef={actionsRef}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (open) {
          removed.current = false
          triggerRef.current = details.trigger ?? null
        }
        if (!open && update.isPending && details.reason !== 'imperative-action') details.cancel()
      }}
      onOpenChangeComplete={(open) => {
        if (!open) {
          update.reset()
          if (removed.current) onRemoved()
        }
      }}
    >
      {({ payload }) => (
        <>
          <div
            ref={listRef}
            data-annotation-list
            role="region"
            aria-label={t(($) => $.title, { ns: 'appAnnotation' })}
            tabIndex={-1}
            className="relative mt-2 grow overflow-x-auto focus-visible:outline-2 focus-visible:outline-components-input-border-active"
          >
            {list.length === 0 && isLoading ? (
              <LoadingPlaceholder className="h-full" />
            ) : list.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyElement />
              </div>
            ) : (
              <CheckboxGroup
                value={selectedIds}
                onValueChange={onSelectedIdsChange}
                allValues={annotationIds}
              >
                <table className="w-full min-w-110 border-collapse border-0">
                  <thead className="system-xs-medium-uppercase text-text-tertiary">
                    <tr>
                      <th className="w-12 rounded-s-lg bg-background-section-burn px-2 text-start align-middle font-[weight:inherit] whitespace-nowrap">
                        <div className="flex items-center">
                          <Checkbox
                            className="shrink-0"
                            parent
                            aria-label={t(($) => $['operation.selectAll'], { ns: 'common' })}
                          />
                        </div>
                      </th>
                      <th className="w-5 bg-background-section-burn ps-2 pe-1 text-start font-[weight:inherit] whitespace-nowrap">
                        {t(($) => $['table.header.question'], { ns: 'appAnnotation' })}
                      </th>
                      <th className="bg-background-section-burn py-1.5 ps-3 text-start font-[weight:inherit] whitespace-nowrap">
                        {t(($) => $['table.header.answer'], { ns: 'appAnnotation' })}
                      </th>
                      <th className="bg-background-section-burn py-1.5 ps-3 text-start font-[weight:inherit] whitespace-nowrap">
                        {t(($) => $['table.header.createdAt'], { ns: 'appAnnotation' })}
                      </th>
                      <th className="bg-background-section-burn py-1.5 ps-3 text-start font-[weight:inherit] whitespace-nowrap">
                        {t(($) => $['table.header.hits'], { ns: 'appAnnotation' })}
                      </th>
                      <th className="w-24 rounded-e-lg bg-background-section-burn py-1.5 ps-3 text-start font-[weight:inherit] whitespace-nowrap">
                        {t(($) => $['table.header.actions'], { ns: 'appAnnotation' })}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="system-sm-regular text-text-secondary">
                    {list.map((item) => (
                      <AnnotationTableRow
                        key={item.id}
                        item={item}
                        formattedCreatedAt={
                          item.created_at
                            ? formatTime(
                                item.created_at,
                                t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
                              )
                            : '-'
                        }
                        appId={appId}
                        onRemoved={onRemoved}
                      />
                    ))}
                  </tbody>
                </table>
              </CheckboxGroup>
            )}
          </div>
          {selectedIds.length > 0 && (
            <BatchAction
              className="absolute inset-s-0 bottom-20 z-20"
              selectedIds={selectedIds}
              onBatchDelete={onBatchDelete}
              onSelectedIdsChange={onSelectedIdsChange}
            />
          )}
          <DialogPortal>
            <DialogBackdrop />
            <DialogPopup
              finalFocus={() => {
                if (removed.current)
                  return removalFocus.current?.isConnected ? removalFocus.current : listRef.current
                return triggerRef.current?.isConnected ? true : listRef.current
              }}
              className="fixed inset-e-2 top-16 bottom-3 flex min-h-0 w-200 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg text-text-primary shadow-xl"
            >
              {payload && (
                <AnnotationDetails
                  key={payload.id}
                  appId={appId}
                  item={payload}
                  isPending={update.isPending}
                  isError={update.isError}
                  onSave={(body, onSuccess) =>
                    update.mutate(
                      { params: { app_id: appId, annotation_id: payload.id }, body },
                      { onSuccess },
                    )
                  }
                  onRemoved={() => {
                    const row = triggerRef.current?.closest('tr')
                    removalFocus.current =
                      row?.nextElementSibling?.querySelector<HTMLButtonElement>('button') ??
                      row?.previousElementSibling?.querySelector<HTMLButtonElement>('button') ??
                      listRef.current
                    removed.current = true
                    actionsRef.current?.close()
                  }}
                />
              )}
            </DialogPopup>
          </DialogPortal>
        </>
      )}
    </Dialog>
  )
}
