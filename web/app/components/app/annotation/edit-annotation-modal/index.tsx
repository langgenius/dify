'use client'

import type { DialogActions } from '@langgenius/dify-ui/dialog'
import {
  Dialog,
  DialogBackdrop,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/console'
import { AnnotationEditor } from './annotation-editor'
import { RemoveAnnotationDialog } from './remove-annotation-dialog'

export type EditAnnotationDialogProps = {
  appId: string
  annotationId: string
  question: string
  answer: string
  createdAt?: number
  onlyEditResponse?: boolean
  onEdited: (question: string, answer: string) => void
  onRemoved: () => void
}

export default function EditAnnotationDialog({
  appId,
  annotationId,
  question,
  answer,
  createdAt,
  onlyEditResponse,
  onEdited,
  onRemoved,
}: EditAnnotationDialogProps) {
  const { t } = useTranslation(['appAnnotation', 'appDebug', 'appLog', 'common'])
  const { formatTime } = useTimestamp()
  const actionsRef = useRef<DialogActions>(null)
  const removed = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const update = useMutation(
    consoleQuery.apps.byAppId.annotations.byAnnotationId.post.mutationOptions({
      context: { silent: true },
    }),
  )
  return (
    <Dialog
      actionsRef={actionsRef}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (open) removed.current = false
        if (!open && update.isPending && details.reason !== 'imperative-action') details.cancel()
      }}
      onOpenChangeComplete={(open) => {
        if (!open) {
          update.reset()
          if (removed.current) onRemoved()
        }
      }}
    >
      <Tooltip>
        <DialogTrigger
          ref={triggerRef}
          render={
            <TooltipTrigger
              render={
                <IconButton aria-label={t(($) => $['feature.annotation.edit'], { ns: 'appDebug' })}>
                  <span aria-hidden className="i-ri-edit-line size-4" />
                </IconButton>
              }
            />
          }
        >
          <span aria-hidden className="i-ri-edit-line size-4" />
        </DialogTrigger>
        <TooltipContent>
          {t(($) => $['feature.annotation.edit'], { ns: 'appDebug' })}
        </TooltipContent>
      </Tooltip>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          finalFocus={() => {
            if (!removed.current) return true
            return (
              Array.from(
                triggerRef.current?.parentElement?.querySelectorAll<HTMLButtonElement>(
                  'button:not([disabled])',
                ) ?? [],
              ).find((button) => button !== triggerRef.current) ?? true
            )
          }}
          className="fixed inset-e-2 top-16 bottom-3 flex min-h-0 w-120 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg text-text-primary shadow-xl"
        >
          <DialogHeader>
            <DialogTitle>{t(($) => $['editModal.title'], { ns: 'appAnnotation' })}</DialogTitle>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              disabled={update.isPending}
            />
          </DialogHeader>
          <DialogBody>
            <AnnotationEditor
              question={question}
              answer={answer}
              onlyEditResponse={onlyEditResponse}
              isPending={update.isPending}
              isError={update.isError}
              onSave={(body, onSuccess) =>
                update.mutate(
                  { params: { app_id: appId, annotation_id: annotationId }, body },
                  {
                    onSuccess: () => {
                      onEdited(body.question, body.answer)
                      onSuccess()
                    },
                  },
                )
              }
            />
          </DialogBody>
          <DialogFooter>
            <RemoveAnnotationDialog
              appId={appId}
              annotationId={annotationId}
              disabled={update.isPending}
              onRemoved={() => {
                removed.current = true
                actionsRef.current?.close()
              }}
            />
            {createdAt != null && (
              <span className="ms-auto system-xs-regular text-text-tertiary">
                {t(($) => $['editModal.createdAt'], { ns: 'appAnnotation' })}{' '}
                {formatTime(
                  createdAt,
                  t(($) => $.dateTimeFormat, { ns: 'appLog' }),
                )}
              </span>
            )}
          </DialogFooter>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
