import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { AlertDialogActions, AlertDialogProps } from '@langgenius/dify-ui/alert-dialog'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useRouter } from '@/next/navigation'
import {
  markAppDeletionFailed,
  markAppDeletionStarted,
  markAppDeletionSucceeded,
} from '@/service/app-deletion'
import { consoleQuery } from '@/service/console'

export function DeleteAppDialog({
  appDetail,
  open,
  onOpenChange,
}: Pick<AlertDialogProps, 'open' | 'onOpenChange'> & {
  appDetail: AppDetailWithSite
}) {
  const actionsRef = useRef<AlertDialogActions>(null)
  const { t } = useTranslation(['app'])
  const confirmationRef = useRef<HTMLInputElement>(null)
  const { replace } = useRouter()
  const deletion = useMutation(
    consoleQuery.apps.byAppId.delete.mutationOptions({
      onMutate: () => markAppDeletionStarted(appDetail.id),
      onError: (error) => {
        markAppDeletionFailed(appDetail.id)
        toast.error(
          `${t(($) => $.appDeleteFailed, { ns: 'app' })}${error instanceof Error ? `: ${error.message}` : ''}`,
        )
      },
    }),
  )
  return (
    <AlertDialog
      actionsRef={actionsRef}
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && deletion.isPending && details.reason !== 'imperative-action')
          details.cancel()
        else onOpenChange?.(nextOpen, details)
      }}
    >
      <AlertDialogContent initialFocus={confirmationRef}>
        <DeleteAppForm
          confirmationRef={confirmationRef}
          appName={appDetail.name}
          isPending={deletion.isPending}
          onSubmit={() => {
            if (!deletion.isPending)
              deletion.mutate(
                { params: { app_id: appDetail.id } },
                {
                  onSuccess: () => {
                    markAppDeletionSucceeded(appDetail.id)
                    actionsRef.current?.close()
                    toast.success(t(($) => $.appDeleted, { ns: 'app' }))
                    replace('/apps')
                  },
                },
              )
          }}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeleteAppForm({
  confirmationRef,
  appName,
  isPending,
  onSubmit,
}: {
  confirmationRef: React.RefObject<HTMLInputElement | null>
  appName: string
  isPending: boolean
  onSubmit: () => void
}) {
  const { t } = useTranslation(['app', 'common'])
  const [name] = useState(appName)
  const [confirmation, setConfirmation] = useState('')
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (!isPending && confirmation === name) onSubmit()
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{t(($) => $.deleteAppConfirmTitle, { ns: 'app' })}</AlertDialogTitle>
        <AlertDialogDescription>
          {t(($) => $.deleteAppConfirmContent, { ns: 'app' })}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogBody>
        <Field name="confirm-app-name">
          <FieldLabel>
            <Trans
              i18nKey={($) => $.deleteAppConfirmInputLabel}
              ns="app"
              values={{ appName: name }}
              components={{
                appName: <span className="system-sm-semibold text-text-primary" translate="no" />,
              }}
            />
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              ref={confirmationRef}
              autoComplete="off"
              spellCheck={false}
              value={confirmation}
              onValueChange={setConfirmation}
              readOnly={isPending}
              placeholder={t(($) => $.deleteAppConfirmInputPlaceholder, { ns: 'app' })}
            />
            <InputGroupAddon align="inline-end">
              <Button
                type="button"
                variant="tertiary"
                size="small"
                disabled={isPending}
                onClick={() => setConfirmation(name)}
              >
                {t(($) => $['operation.fill'], { ns: 'common' })}
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </AlertDialogBody>
      <AlertDialogFooter>
        <AlertDialogCancelButton type="button" disabled={isPending}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <AlertDialogConfirmButton
          type="submit"
          loading={isPending}
          disabled={confirmation !== name}
        >
          {t(($) => $['operation.confirm'], { ns: 'common' })}
        </AlertDialogConfirmButton>
      </AlertDialogFooter>
    </form>
  )
}
