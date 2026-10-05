'use client'

import type { AccountPasswordPayload } from '@dify/contracts/api/console/account/types.gen'
import type { DialogProps } from '@langgenius/dify-ui/dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { validPassword } from '@/config'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'

type ChangePasswordFormProps = {
  isPasswordSet: boolean
  isPending: boolean
  onSave: (password: AccountPasswordPayload) => Promise<void>
}

function ChangePasswordForm({ isPasswordSet, isPending, onSave }: ChangePasswordFormProps) {
  const { t } = useTranslation(['common', 'login', 'accountSettings'])
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const handleSubmit = () => {
    if (isPending) return
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
      password: currentPassword,
      new_password: password,
      repeat_new_password: confirmPassword,
    })
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
    >
      <DialogTitle className="mb-6 title-2xl-semi-bold text-text-primary">
        {isPasswordSet
          ? t(($) => $['account.resetPassword'], { ns: 'accountSettings' })
          : t(($) => $['account.setPassword'], { ns: 'accountSettings' })}
      </DialogTitle>
      {isPasswordSet && (
        <Field name="current-password">
          <FieldLabel className="system-sm-semibold">
            {t(($) => $['account.currentPassword'], { ns: 'accountSettings' })}
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              type={showCurrentPassword ? 'text' : 'password'}
              value={currentPassword}
              onValueChange={setCurrentPassword}
              autoComplete="current-password"
              spellCheck={false}
              readOnly={isPending}
            />
            <InputGroupAddon align="inline-end">
              <IconButton
                size="lg"
                aria-label={t(($) => $[showCurrentPassword ? 'hidePassword' : 'showPassword'], {
                  ns: 'login',
                })}
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              >
                <span aria-hidden="true">{showCurrentPassword ? '👀' : '😝'}</span>
              </IconButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      )}
      <Field name="new-password" className="mt-8">
        <FieldLabel className="system-sm-semibold">
          {isPasswordSet
            ? t(($) => $['account.newPassword'], { ns: 'accountSettings' })
            : t(($) => $['account.password'], { ns: 'accountSettings' })}
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
            type={showPassword ? 'text' : 'password'}
            value={password}
            onValueChange={setPassword}
            autoComplete="new-password"
            spellCheck={false}
            readOnly={isPending}
          />
          <InputGroupAddon align="inline-end">
            <IconButton
              size="lg"
              aria-label={t(($) => $[showPassword ? 'hidePassword' : 'showPassword'], {
                ns: 'login',
              })}
              onClick={() => setShowPassword(!showPassword)}
            >
              <span aria-hidden="true">{showPassword ? '👀' : '😝'}</span>
            </IconButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
      <Field name="confirm-password" className="mt-8">
        <FieldLabel className="system-sm-semibold">
          {t(($) => $['account.confirmPassword'], { ns: 'accountSettings' })}
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
            type={showConfirmPassword ? 'text' : 'password'}
            value={confirmPassword}
            onValueChange={setConfirmPassword}
            autoComplete="new-password"
            spellCheck={false}
            readOnly={isPending}
          />
          <InputGroupAddon align="inline-end">
            <IconButton
              size="lg"
              aria-label={t(($) => $[showConfirmPassword ? 'hidePassword' : 'showPassword'], {
                ns: 'login',
              })}
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            >
              <span aria-hidden="true">{showConfirmPassword ? '👀' : '😝'}</span>
            </IconButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>
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
    </form>
  )
}

export function ChangePasswordDialog({ isPasswordSet }: { isPasswordSet: boolean }) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const actionsRef: DialogProps['actionsRef'] = useRef(null)
  const queryClient = useQueryClient()
  const updatePassword = useMutation(
    consoleQuery.account.password.post.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: userProfileQueryOptions().queryKey }),
    }),
  )

  const handleSave = async (password: AccountPasswordPayload) => {
    try {
      await updatePassword.mutateAsync({ body: password })
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      actionsRef.current?.close()
    } catch (error) {
      toast.error((error as Error).message)
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
