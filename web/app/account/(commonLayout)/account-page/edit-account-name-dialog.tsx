'use client'

import type { DialogActions } from '@langgenius/dify-ui/dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'

type EditAccountNameFormProps = {
  name: string
  isPending: boolean
  onSave: (name: string) => Promise<void>
}

function EditAccountNameForm({ name, isPending, onSave }: EditAccountNameFormProps) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const [draftName, setDraftName] = useState(name)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!isPending && draftName) void onSave(draftName)
      }}
    >
      <DialogTitle className="mb-6 title-2xl-semi-bold text-text-primary">
        {t(($) => $['account.editName'], { ns: 'accountSettings' })}
      </DialogTitle>
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
      <div className="mt-10 flex justify-end">
        <DialogClose render={<Button className="mr-2" disabled={isPending} />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" disabled={!draftName} loading={isPending} variant="primary">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
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
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully']))
      actionsRef.current?.close()
    } catch (error) {
      // The request layer already reports every error the server answered with.
      // Only report a failure that never produced a response.
      if (error instanceof Error && error.message) toast.error(error.message)
    }
  }

  return (
    <Dialog
      actionsRef={actionsRef}
      onOpenChange={(open, details) => {
        if (!open && updateProfile.isPending && details.reason !== 'imperative-action')
          details.cancel()
      }}
    >
      <DialogTrigger className="cursor-pointer rounded-lg bg-components-button-tertiary-bg px-3 py-2 system-sm-medium text-components-button-tertiary-text">
        {t(($) => $['operation.edit'])}
      </DialogTrigger>
      <DialogContent className="w-105 p-6">
        <EditAccountNameForm name={name} isPending={updateProfile.isPending} onSave={handleSave} />
      </DialogContent>
    </Dialog>
  )
}
