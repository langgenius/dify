'use client'

import type { DialogActions } from '@langgenius/dify-ui/dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'

type EditAccountNameFormProps = {
  name: string
  error?: unknown
  isPending: boolean
  onSave: (name: string) => Promise<void>
}

function EditAccountNameForm({ name, isPending, error, onSave }: EditAccountNameFormProps) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const [draftName, setDraftName] = useState(name)

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (!isPending && draftName) void onSave(draftName)
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(($) => $['account.editName'], { ns: 'accountSettings' })}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <Field name="name" className="gap-0">
          <FieldLabel className="py-0 system-sm-semibold text-text-secondary">
            {t(($) => $['account.name'], { ns: 'accountSettings' })}
          </FieldLabel>
          <Input
            className="mt-2"
            value={draftName}
            onValueChange={setDraftName}
            readOnly={isPending}
          />
        </Field>
        {!!error && !isPending && (
          <p role="alert" className="system-sm-regular text-text-destructive">
            {getErrorMessage(error) ?? t(($) => $['api.actionFailed'], { ns: 'common' })}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button disabled={isPending} />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" disabled={!draftName} loading={isPending} variant="primary">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function EditAccountNameDialog({ name }: { name: string }) {
  const { t } = useTranslation(['common'])
  const actionsRef = useRef<DialogActions>(null)
  const updateProfile = useMutation(consoleQuery.account.profile.patch.mutationOptions())

  const handleSave = async (name: string) => {
    try {
      await updateProfile.mutateAsync({ body: { name } })
      actionsRef.current?.close()
    } catch {
      // The form renders the mutation error and keeps the draft for retry.
    }
  }

  return (
    <Dialog
      actionsRef={actionsRef}
      onOpenChangeComplete={(open) => {
        if (!open) updateProfile.reset()
      }}
      onOpenChange={(open, details) => {
        if (!open && updateProfile.isPending && details.reason !== 'imperative-action')
          details.cancel()
      }}
    >
      <DialogTrigger className="cursor-pointer rounded-lg bg-components-button-tertiary-bg px-3 py-2 system-sm-medium text-components-button-tertiary-text">
        {t(($) => $['operation.edit'])}
      </DialogTrigger>
      <DialogContent className="w-105">
        <EditAccountNameForm
          error={updateProfile.error}
          name={name}
          isPending={updateProfile.isPending}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  )
}
