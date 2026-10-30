'use client'

import type { CreateAnnotationPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Dialog,
  DialogBackdrop,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AnnotationFull from '@/app/components/billing/annotation-full'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import robotAvatar from '../assets/robot-avatar.svg'

type AddAnnotationDialogProps = {
  appId: string
  onAdded: () => void
}

type AddAnnotationDialogPopupProps = {
  isPending: boolean
  isError: boolean
  onSave: (body: CreateAnnotationPayload, onSuccess: () => void) => void
  onClose: () => void
}

function AddAnnotationDialogPopup({
  isPending,
  isError,
  onSave,
  onClose,
}: AddAnnotationDialogPopupProps) {
  const { t } = useTranslation(['appAnnotation', 'common'])
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const quota = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.annotation_quota_limit,
    }),
  )
  const quotaUnavailable = deploymentEdition === 'CLOUD' && quota.data === undefined
  // A limit of 0 means unlimited.
  const quotaFull =
    deploymentEdition === 'CLOUD' &&
    quota.data !== undefined &&
    quota.data.limit > 0 &&
    quota.data.size >= quota.data.limit
  const formId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const questionRef = useRef<HTMLTextAreaElement>(null)
  const [createNext, setCreateNext] = useState(false)

  return (
    <DialogPopup
      initialFocus={questionRef}
      className="fixed inset-e-2 top-16 bottom-3 flex min-h-0 w-120 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg text-text-primary shadow-xl"
    >
      <DialogHeader>
        <DialogTitle>{t(($) => $['addModal.title'], { ns: 'appAnnotation' })}</DialogTitle>
        <DialogHeaderCloseButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          disabled={isPending}
        />
      </DialogHeader>
      <Form<CreateAnnotationPayload>
        id={formId}
        ref={formRef}
        className="contents"
        onFormSubmit={(values) => {
          if (isPending || quotaUnavailable || quotaFull) return
          onSave(values, () => {
            if (createNext) {
              formRef.current?.reset()
              questionRef.current?.focus()
            } else {
              onClose()
            }
          })
        }}
      >
        <DialogBody>
          <div className="space-y-6">
            <Field name="question">
              <FieldLabel className="flex items-center gap-2">
                <span aria-hidden className="i-custom-public-avatar-user size-6 shrink-0" />
                {t(($) => $['addModal.queryName'], { ns: 'appAnnotation' })}
              </FieldLabel>
              <Textarea
                ref={questionRef}
                defaultValue=""
                required
                readOnly={isPending}
                placeholder={t(($) => $['addModal.queryPlaceholder'], { ns: 'appAnnotation' })}
              />
              <FieldError match="valueMissing">
                {t(($) => $['errorMessage.queryRequired'], { ns: 'appAnnotation' })}
              </FieldError>
            </Field>
            <Field name="answer">
              <FieldLabel className="flex items-center gap-2">
                <img aria-hidden src={robotAvatar.src} alt="" width={24} height={24} />
                {t(($) => $['addModal.answerName'], { ns: 'appAnnotation' })}
              </FieldLabel>
              <Textarea
                defaultValue=""
                required
                readOnly={isPending}
                placeholder={t(($) => $['addModal.answerPlaceholder'], { ns: 'appAnnotation' })}
              />
              <FieldError match="valueMissing">
                {t(($) => $['errorMessage.answerRequired'], { ns: 'appAnnotation' })}
              </FieldError>
            </Field>
            {isError && (
              <p role="alert" className="system-sm-regular text-text-destructive">
                {t(($) => $['api.actionFailed'], { ns: 'common' })}
              </p>
            )}
            {quotaFull && <AnnotationFull />}
            {quotaUnavailable && quota.isError && (
              <div role="alert" className="space-y-2">
                <p className="system-sm-regular text-text-destructive">
                  {t(($) => $['api.actionFailed'], { ns: 'common' })}
                </p>
                <Button loading={quota.isFetching} onClick={() => quota.refetch()}>
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              </div>
            )}
          </div>
        </DialogBody>
      </Form>
      <DialogFooter>
        <Field className="me-auto" disabled={isPending}>
          <FieldLabel className="flex items-center gap-2">
            <Checkbox checked={createNext} onCheckedChange={setCreateNext} />
            {t(($) => $['addModal.createNext'], { ns: 'appAnnotation' })}
          </FieldLabel>
        </Field>
        <DialogClose disabled={isPending} render={<Button />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button
          type="submit"
          form={formId}
          variant="primary"
          loading={isPending}
          disabled={quotaUnavailable || quotaFull}
        >
          {t(($) => $['operation.add'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </DialogPopup>
  )
}

export default function AddAnnotationDialog({ appId, onAdded }: AddAnnotationDialogProps) {
  const { t } = useTranslation(['appAnnotation'])
  const actionsRef = useRef<DialogActions>(null)
  const creation = useMutation(
    consoleQuery.apps.byAppId.annotations.post.mutationOptions({
      context: { silent: true },
      onSuccess: onAdded,
    }),
  )

  return (
    <Dialog
      actionsRef={actionsRef}
      disablePointerDismissal
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && creation.isPending && details.reason !== 'imperative-action') {
          details.cancel()
        }
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) creation.reset()
      }}
    >
      <DialogTrigger render={<Button variant="primary" />}>
        <span aria-hidden className="i-ri-add-line size-4" />
        {t(($) => $['table.header.addAnnotation'], { ns: 'appAnnotation' })}
      </DialogTrigger>
      <DialogPortal>
        <DialogBackdrop />
        <AddAnnotationDialogPopup
          isPending={creation.isPending}
          isError={creation.isError}
          onSave={(body, onSuccess) => {
            creation.mutate({ params: { app_id: appId }, body }, { onSuccess })
          }}
          onClose={() => actionsRef.current?.close()}
        />
      </DialogPortal>
    </Dialog>
  )
}
