import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'

type RemoveAnnotationDialogProps = {
  appId: string
  annotationId: string
  disabled: boolean
  onRemoved: () => void
}

export function RemoveAnnotationDialog({
  appId,
  annotationId,
  disabled,
  onRemoved,
}: RemoveAnnotationDialogProps) {
  const { t } = useTranslation(['appAnnotation', 'appDebug', 'common'])
  const actionsRef = useRef<AlertDialogActions>(null)
  const removal = useMutation(
    consoleQuery.apps.byAppId.annotations.byAnnotationId.delete.mutationOptions({
      context: { silent: true },
      onSuccess: () => {
        actionsRef.current?.close()
        onRemoved()
      },
    }),
  )
  return (
    <AlertDialog
      actionsRef={actionsRef}
      onOpenChange={(open, details) => {
        if (!open && removal.isPending && details.reason !== 'imperative-action') details.cancel()
      }}
      onOpenChangeComplete={(open) => {
        if (!open) removal.reset()
      }}
    >
      <AlertDialogTrigger disabled={disabled} render={<Button variant="ghost" />}>
        <span
          aria-hidden
          className="i-custom-vender-line-communication-message-check-remove size-5"
        />
        {t(($) => $['editModal.removeThisCache'], { ns: 'appAnnotation' })}
      </AlertDialogTrigger>
      <AlertDialogContent backdropProps={{ forceRender: true }}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $['feature.annotation.removeConfirm'], { ns: 'appDebug' })}
          </AlertDialogTitle>
        </AlertDialogHeader>
        {removal.isError && (
          <AlertDialogBody>
            <p role="alert" className="text-text-destructive">
              {t(($) => $['api.actionFailed'], { ns: 'common' })}
            </p>
          </AlertDialogBody>
        )}
        <AlertDialogFooter>
          <AlertDialogCancelButton disabled={removal.isPending}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            loading={removal.isPending}
            onClick={() => {
              if (!removal.isPending)
                removal.mutate({ params: { app_id: appId, annotation_id: annotationId } })
            }}
          >
            {t(($) => $['operation.confirm'], { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
