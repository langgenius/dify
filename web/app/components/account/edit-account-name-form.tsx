'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type EditAccountNameFormProps = {
  name: string
  isPending: boolean
  onSave: (name: string) => Promise<void>
  error?: string
  validateName?: (name: string) => string | undefined
}

export function EditAccountNameForm({
  name,
  isPending,
  onSave,
  error,
  validateName,
}: EditAccountNameFormProps) {
  const { t } = useTranslation(['common', 'accountSettings', 'login'])
  const [draftName, setDraftName] = useState(name)
  const [nameError, setNameError] = useState<string | null>(null)
  const getNameError = (value: string) =>
    value ? validateName?.(value) : t(($) => $['error.nameEmpty'], { ns: 'login' })

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (isPending) return
        const validationError = getNameError(draftName)
        setNameError(validationError ?? null)
        if (!validationError) void onSave(draftName)
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(($) => $['account.editName'], { ns: 'accountSettings' })}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <Field name="name" invalid={!!nameError} className="gap-0">
          <FieldLabel className="py-0 system-sm-semibold text-text-secondary">
            {t(($) => $['account.name'], { ns: 'accountSettings' })}
          </FieldLabel>
          <Input
            className="mt-2"
            value={draftName}
            onValueChange={(value) => {
              setDraftName(value)
              if (nameError) setNameError(getNameError(value) ?? null)
            }}
            readOnly={isPending}
          />
          {nameError && <FieldError match>{nameError}</FieldError>}
        </Field>
        {error && (
          <p role="alert" className="mt-4 system-sm-regular text-text-destructive">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button disabled={isPending} />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" loading={isPending} variant="primary">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </form>
  )
}
