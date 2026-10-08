'use client'

import type { AccountPasswordPayload } from '@dify/contracts/api/console/account/types.gen'
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
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { validPassword } from '@/config'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'

type ChangePasswordFormValues = {
  'current-password'?: string
  'new-password': string
  'confirm-password': string
}

type PasswordFieldProps = {
  name: keyof ChangePasswordFormValues
  label: string
  autoComplete: 'current-password' | 'new-password'
  readOnly: boolean
  className?: string
}

function PasswordField({ name, label, autoComplete, readOnly, className }: PasswordFieldProps) {
  const { t } = useTranslation(['login'])
  const [visible, setVisible] = useState(false)

  return (
    <Field name={name} className={className}>
      <FieldLabel className="system-sm-semibold">{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          spellCheck={false}
          readOnly={readOnly}
        />
        <InputGroupAddon align="inline-end">
          <IconButton
            size="lg"
            aria-label={t(($) => $[visible ? 'hidePassword' : 'showPassword'], { ns: 'login' })}
            onClick={() => setVisible(!visible)}
          >
            <span aria-hidden="true">{visible ? '👀' : '😝'}</span>
          </IconButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  )
}

type ChangePasswordFormProps = {
  isPasswordSet: boolean
  isPending: boolean
  onSave: (password: AccountPasswordPayload) => Promise<void>
}

function ChangePasswordForm({
  isPasswordSet: initialIsPasswordSet,
  isPending,
  onSave,
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
    <Form<ChangePasswordFormValues> onFormSubmit={handleSubmit}>
      <DialogTitle className="mb-6 title-2xl-semi-bold text-text-primary">
        {isPasswordSet
          ? t(($) => $['account.resetPassword'], { ns: 'accountSettings' })
          : t(($) => $['account.setPassword'], { ns: 'accountSettings' })}
      </DialogTitle>
      {isPasswordSet && (
        <PasswordField
          name="current-password"
          label={t(($) => $['account.currentPassword'], { ns: 'accountSettings' })}
          autoComplete="current-password"
          readOnly={isPending}
        />
      )}
      <PasswordField
        name="new-password"
        label={
          isPasswordSet
            ? t(($) => $['account.newPassword'], { ns: 'accountSettings' })
            : t(($) => $['account.password'], { ns: 'accountSettings' })
        }
        autoComplete="new-password"
        readOnly={isPending}
        className="mt-8"
      />
      <PasswordField
        name="confirm-password"
        label={t(($) => $['account.confirmPassword'], { ns: 'accountSettings' })}
        autoComplete="new-password"
        readOnly={isPending}
        className="mt-8"
      />
      <div className="mt-10 flex justify-end">
        <DialogClose render={<Button className="mr-2" disabled={isPending} />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" loading={isPending} variant="primary">
          {isPasswordSet
            ? t(($) => $['operation.reset'], { ns: 'common' })
            : t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
    </Form>
  )
}

export function ChangePasswordDialog({ isPasswordSet }: { isPasswordSet: boolean }) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const actionsRef = useRef<DialogActions>(null)
  const queryClient = useQueryClient()
  const updatePassword = useMutation(
    consoleQuery.account.password.post.mutationOptions({
      onSuccess: () => {
        // The request alone decides success; a slow profile refresh must not keep the dialog locked.
        void queryClient.invalidateQueries({ queryKey: userProfileQueryOptions().queryKey })
      },
    }),
  )

  const handleSave = async (password: AccountPasswordPayload) => {
    try {
      await updatePassword.mutateAsync({ body: password })
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
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
        if (!open && updatePassword.isPending && details.reason !== 'imperative-action')
          details.cancel()
      }}
    >
      <DialogTrigger render={<Button />}>
        {isPasswordSet
          ? t(($) => $['account.resetPassword'], { ns: 'accountSettings' })
          : t(($) => $['account.setPassword'], { ns: 'accountSettings' })}
      </DialogTrigger>
      <DialogContent className="w-105! p-6!">
        <ChangePasswordForm
          isPasswordSet={isPasswordSet}
          isPending={updatePassword.isPending}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  )
}
