'use client'

import type { AccountPasswordPayload } from '@dify/contracts/api/console/account/types.gen'
import type { FormProps } from '@langgenius/dify-ui/form'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import {
  PasswordField,
  PasswordFieldInput,
  PasswordFieldToggle,
} from '@langgenius/dify-ui/password-field'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { validPassword } from '@/config'

type ChangePasswordFormValues = {
  'current-password'?: string
  'new-password': string
  'confirm-password': string
}

type ChangePasswordFieldProps = {
  name: keyof ChangePasswordFormValues
  label: string
  autoComplete: 'current-password' | 'new-password'
  readOnly: boolean
}

function ChangePasswordField({ name, label, autoComplete, readOnly }: ChangePasswordFieldProps) {
  const { t } = useTranslation(['login'])

  return (
    <Field name={name}>
      <FieldLabel className="system-sm-semibold">{label}</FieldLabel>
      <PasswordField>
        <PasswordFieldInput autoComplete={autoComplete} readOnly={readOnly} />
        <PasswordFieldToggle aria-label={t(($) => $.showPassword, { ns: 'login' })} />
      </PasswordField>
      <FieldError />
    </Field>
  )
}

type ChangePasswordFormProps = {
  isPasswordSet: boolean
  isPending: boolean
  onSave: (password: AccountPasswordPayload & { password: string }) => Promise<void>
  error?: string
  errors?: FormProps<ChangePasswordFormValues>['errors']
}

export function ChangePasswordForm({
  isPasswordSet: initialIsPasswordSet,
  isPending,
  onSave,
  error,
  errors,
}: ChangePasswordFormProps) {
  const { t } = useTranslation(['common', 'login', 'accountSettings'])
  // A successful first save refreshes the profile while the popup is still exiting.
  // Keep the mode this session opened with instead of switching to the reset form.
  const [isPasswordSet] = useState(initialIsPasswordSet)

  const handleSubmit = (values: ChangePasswordFormValues) => {
    if (isPending) return
    const password = values['new-password']
    const confirmPassword = values['confirm-password']
    if (!password.trim()) {
      toast.error(t(($) => $['error.passwordEmpty'], { ns: 'login' }))
      return
    }
    if (!validPassword.test(password)) {
      toast.error(t(($) => $['error.passwordInvalid'], { ns: 'login' }))
      return
    }
    if (password !== confirmPassword) {
      toast.error(t(($) => $['account.notEqual'], { ns: 'accountSettings' }))
      return
    }
    void onSave({
      password: values['current-password'] ?? '',
      new_password: password,
      repeat_new_password: confirmPassword,
    })
  }

  return (
    <Form<ChangePasswordFormValues>
      className="contents"
      onFormSubmit={handleSubmit}
      errors={errors}
    >
      <DialogHeader>
        <DialogTitle>
          {isPasswordSet
            ? t(($) => $['account.resetPassword'], { ns: 'accountSettings' })
            : t(($) => $['account.setPassword'], { ns: 'accountSettings' })}
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-8">
        {isPasswordSet && (
          <ChangePasswordField
            name="current-password"
            label={t(($) => $['account.currentPassword'], { ns: 'accountSettings' })}
            autoComplete="current-password"
            readOnly={isPending}
          />
        )}
        <ChangePasswordField
          name="new-password"
          label={
            isPasswordSet
              ? t(($) => $['account.newPassword'], { ns: 'accountSettings' })
              : t(($) => $['account.password'], { ns: 'accountSettings' })
          }
          autoComplete="new-password"
          readOnly={isPending}
        />
        <ChangePasswordField
          name="confirm-password"
          label={t(($) => $['account.confirmPassword'], { ns: 'accountSettings' })}
          autoComplete="new-password"
          readOnly={isPending}
        />
        {error && (
          <p role="alert" className="system-sm-regular text-text-destructive">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button disabled={isPending} />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" loading={isPending} variant="primary">
          {isPasswordSet
            ? t(($) => $['operation.reset'], { ns: 'common' })
            : t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </Form>
  )
}
