'use client'

import type {
  ChangeEmailResetPayload,
  ChangeEmailSendPayload,
  ChangeEmailValidityPayload,
  CheckEmailUniquePayload,
  SimpleResultDataResponse,
  SimpleResultResponse,
  VerificationTokenResponse,
} from '@dify/contracts/api/console/account/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { ORPCError } from '@orpc/client'
import { useMutation } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { getErrorMessage } from '@/utils/error-message'

export type ChangeEmailActions = {
  sendCode: (body: ChangeEmailSendPayload) => Promise<SimpleResultDataResponse>
  verifyCode: (body: ChangeEmailValidityPayload) => Promise<VerificationTokenResponse>
  checkEmailUnique: (body: CheckEmailUniquePayload) => Promise<SimpleResultResponse>
  changeEmail: (body: ChangeEmailResetPayload) => Promise<void>
}

type Props = {
  onClose: () => void
  email: string
  actions: ChangeEmailActions
}

const STEP = {
  start: 'start',
  verifyOrigin: 'verifyOrigin',
  newEmail: 'newEmail',
  verifyNew: 'verifyNew',
} as const

type Step = (typeof STEP)[keyof typeof STEP]
type Operation = 'sendOrigin' | 'verifyOrigin' | 'sendNew' | 'verifyNew'

const emailPattern = /^[\w.!#$%&'*+\-/=?^`{|}~]+@(?:[\w-]+\.)+[\w-]{2,}$/

export default function ChangeEmailDialog({ onClose, email, actions }: Props) {
  const { t } = useTranslation(['common', 'accountSettings', 'login'])
  const [step, setStep] = useState<Step>(STEP.start)
  const [code, setCode] = useState('')
  const [mail, setMail] = useState('')
  const [time, setTime] = useState(0)
  const [stepToken, setStepToken] = useState('')
  const [emailError, setEmailError] = useState<string>()
  const [checkedEmail, setCheckedEmail] = useState<string>()
  const [isCheckingEmail, setIsCheckingEmail] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const latestEmailRef = useRef('')
  const submissionRef = useRef(false)
  const verifiedNewTokenRef = useRef<string | null>(null)

  const clearCountdown = useCallback(() => {
    if (!timerRef.current) return
    clearInterval(timerRef.current)
    timerRef.current = null
  }, [])
  useEffect(() => clearCountdown, [clearCountdown])

  const startCount = () => {
    clearCountdown()
    setTime(60)
    timerRef.current = setInterval(() => {
      setTime((previous) => {
        if (previous <= 1) {
          clearCountdown()
          return 0
        }
        return previous - 1
      })
    }, 1000)
  }

  const sendCode = async (address: string, phase: 'old_email' | 'new_email', token?: string) => {
    const result = await actions.sendCode({ email: address, phase, token })
    if (result.result !== 'success' || !result.data)
      throw new Error(t(($) => $['api.actionFailed'], { ns: 'common' }))
    startCount()
    setStepToken(result.data)
    setCode('')
    verifiedNewTokenRef.current = null
  }

  const verifyCode = async (address: string) => {
    const result = await actions.verifyCode({ email: address, code, token: stepToken })
    if (!result.is_valid) throw new Error(t(($) => $['checkCode.invalidCode'], { ns: 'login' }))
    return result.token
  }

  const operation = useMutation({
    mutationFn: async (command: Operation) => {
      if (command === 'sendOrigin') {
        await sendCode(email, 'old_email')
        setStep(STEP.verifyOrigin)
        return
      }
      if (command === 'verifyOrigin') {
        const token = await verifyCode(email)
        setStepToken(token)
        setCode('')
        setStep(STEP.newEmail)
        return
      }
      if (command === 'sendNew') {
        await sendCode(mail.trim(), 'new_email', stepToken)
        setStep(STEP.verifyNew)
        return
      }
      // Retry a failed save without consuming the verification code again.
      const token = verifiedNewTokenRef.current ?? (await verifyCode(mail.trim()))
      verifiedNewTokenRef.current = token
      await actions.changeEmail({ new_email: mail.trim(), token })
    },
    onSettled: () => {
      submissionRef.current = false
    },
  })
  const isPending = operation.isPending
  const errorMessage = operation.error
    ? getErrorMessage(operation.error) || t(($) => $['api.actionFailed'], { ns: 'common' })
    : undefined
  const codeError =
    operation.error instanceof ORPCError && operation.error.code === 'email_code_error'
      ? errorMessage
      : undefined
  const runOperation = (command: Operation) => {
    if (submissionRef.current) return
    submissionRef.current = true
    operation.mutate(command)
  }

  const checkNewEmailExisted = async (address: string) => {
    try {
      const result = await actions.checkEmailUnique({ email: address })
      if (latestEmailRef.current !== address) return
      if (result.result !== 'success')
        throw new Error(t(($) => $['api.actionFailed'], { ns: 'common' }))
      setCheckedEmail(address)
      setEmailError(undefined)
    } catch (error) {
      if (latestEmailRef.current !== address) return
      setCheckedEmail(undefined)
      if (error instanceof ORPCError && error.code === 'email_already_in_use')
        setEmailError(t(($) => $['account.changeEmail.existingEmail'], { ns: 'accountSettings' }))
      else if (error instanceof ORPCError && error.code === 'account_in_freeze')
        setEmailError(
          t(($) => $['account.changeEmail.unAvailableEmail'], { ns: 'accountSettings' }),
        )
      else
        setEmailError(getErrorMessage(error) || t(($) => $['api.actionFailed'], { ns: 'common' }))
    } finally {
      if (latestEmailRef.current === address) setIsCheckingEmail(false)
    }
  }
  const { run: checkEmailDebounced, cancel: cancelEmailCheck } = useDebounceFn(
    checkNewEmailExisted,
    { wait: 500 },
  )
  useEffect(() => cancelEmailCheck, [cancelEmailCheck])

  const handleNewEmailValueChange = (value: string) => {
    const address = value.trim()
    latestEmailRef.current = address
    setMail(value)
    setCheckedEmail(undefined)
    setEmailError(undefined)
    operation.reset()
    if (emailPattern.test(address)) {
      setIsCheckingEmail(true)
      checkEmailDebounced(address)
      return
    }
    cancelEmailCheck()
    setIsCheckingEmail(false)
  }

  const normalizedMail = mail.trim()
  const isSendCodeDisabled =
    !emailPattern.test(normalizedMail) ||
    checkedEmail !== normalizedMail ||
    !!emailError ||
    isCheckingEmail

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return
        if (submissionRef.current) {
          details.cancel()
          return
        }
        onClose()
      }}
    >
      <DialogContent className="w-105">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            if (step === STEP.start) runOperation('sendOrigin')
            else if (step === STEP.verifyOrigin && code.length === 6) runOperation('verifyOrigin')
            else if (step === STEP.newEmail && !isSendCodeDisabled) runOperation('sendNew')
            else if (step === STEP.verifyNew && code.length === 6) runOperation('verifyNew')
          }}
        >
          {step === STEP.start && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t(($) => $['account.changeEmail.title'], { ns: 'accountSettings' })}
                </DialogTitle>
                <DialogHeaderCloseButton
                  disabled={isPending}
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                />
              </DialogHeader>
              <DialogBody>
                <div className="space-y-0.5 pt-1 pb-2">
                  <div className="body-md-medium text-text-warning">
                    {t(($) => $['account.changeEmail.authTip'], { ns: 'accountSettings' })}
                  </div>
                  <div className="body-md-regular text-text-secondary">
                    <Trans
                      i18nKey={($) => $['account.changeEmail.content1']}
                      ns="accountSettings"
                      components={{
                        email: <span className="body-md-medium text-text-primary"></span>,
                      }}
                      values={{ email }}
                    />
                  </div>
                </div>
                {errorMessage && (
                  <p role="alert" className="mt-3 system-sm-regular text-text-destructive">
                    {errorMessage}
                  </p>
                )}
              </DialogBody>
              <DialogFooter className="flex-col items-stretch">
                <Button variant="primary" type="submit" loading={isPending}>
                  {t(($) => $['account.changeEmail.sendVerifyCode'], { ns: 'accountSettings' })}
                </Button>
                <Button onClick={onClose} disabled={isPending}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </Button>
              </DialogFooter>
            </>
          )}
          {step === STEP.verifyOrigin && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t(($) => $['account.changeEmail.verifyEmail'], { ns: 'accountSettings' })}
                </DialogTitle>
                <DialogHeaderCloseButton
                  disabled={isPending}
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                />
              </DialogHeader>
              <DialogBody>
                <div className="space-y-0.5 pt-1 pb-2">
                  <div className="body-md-regular text-text-secondary">
                    <Trans
                      i18nKey={($) => $['account.changeEmail.content2']}
                      ns="accountSettings"
                      components={{
                        email: <span className="body-md-medium text-text-primary"></span>,
                      }}
                      values={{ email }}
                    />
                  </div>
                </div>
                <Field name="code" invalid={!!codeError} className="pt-3">
                  <FieldLabel>
                    {t(($) => $['account.changeEmail.codeLabel'], { ns: 'accountSettings' })}
                  </FieldLabel>
                  <Input
                    className="w-full!"
                    placeholder={t(($) => $['account.changeEmail.codePlaceholder'], {
                      ns: 'accountSettings',
                    })}
                    value={code}
                    onValueChange={(value) => {
                      setCode(value)
                      verifiedNewTokenRef.current = null
                      operation.reset()
                    }}
                    readOnly={isPending}
                    autoComplete="one-time-code"
                    maxLength={6}
                  />
                  {codeError && <FieldError match>{codeError}</FieldError>}
                </Field>
                {errorMessage && !codeError && (
                  <p role="alert" className="mt-3 system-sm-regular text-text-destructive">
                    {errorMessage}
                  </p>
                )}
              </DialogBody>
              <DialogFooter className="flex-col items-stretch">
                <Button
                  disabled={code.length !== 6}
                  variant="primary"
                  type="submit"
                  loading={isPending}
                >
                  {t(($) => $['account.changeEmail.continue'], { ns: 'accountSettings' })}
                </Button>
                <Button onClick={onClose} disabled={isPending}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </Button>
                <div className="flex items-center gap-1 system-xs-regular text-text-tertiary">
                  <span>
                    {t(($) => $['account.changeEmail.resendTip'], { ns: 'accountSettings' })}
                  </span>
                  {time > 0 && (
                    <span>
                      {t(($) => $['account.changeEmail.resendCount'], {
                        ns: 'accountSettings',
                        count: time,
                      })}
                    </span>
                  )}
                  {!time && (
                    <button
                      type="button"
                      onClick={() => runOperation('sendOrigin')}
                      disabled={isPending}
                      className="cursor-pointer rounded-sm system-xs-medium text-text-accent-secondary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    >
                      {t(($) => $['account.changeEmail.resend'], { ns: 'accountSettings' })}
                    </button>
                  )}
                </div>
              </DialogFooter>
            </>
          )}
          {step === STEP.newEmail && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t(($) => $['account.changeEmail.newEmail'], { ns: 'accountSettings' })}
                </DialogTitle>
                <DialogHeaderCloseButton
                  disabled={isPending}
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                />
              </DialogHeader>
              <DialogBody>
                <div className="space-y-0.5 pt-1 pb-2">
                  <div className="body-md-regular text-text-secondary">
                    {t(($) => $['account.changeEmail.content3'], { ns: 'accountSettings' })}
                  </div>
                </div>
                <Field name="email" invalid={!!emailError} className="pt-3">
                  <FieldLabel>
                    {t(($) => $['account.changeEmail.emailLabel'], { ns: 'accountSettings' })}
                  </FieldLabel>
                  <Input
                    className="w-full!"
                    placeholder={t(($) => $['account.changeEmail.emailPlaceholder'], {
                      ns: 'accountSettings',
                    })}
                    value={mail}
                    onValueChange={(value) => handleNewEmailValueChange(value)}
                    type="email"
                    readOnly={isPending}
                    autoComplete="email"
                  />
                  {emailError && <FieldError match>{emailError}</FieldError>}
                </Field>
                {errorMessage && (
                  <p role="alert" className="mt-3 system-sm-regular text-text-destructive">
                    {errorMessage}
                  </p>
                )}
              </DialogBody>
              <DialogFooter className="flex-col items-stretch">
                <Button
                  disabled={isSendCodeDisabled}
                  variant="primary"
                  type="submit"
                  loading={isPending}
                >
                  {t(($) => $['account.changeEmail.sendVerifyCode'], { ns: 'accountSettings' })}
                </Button>
                <Button onClick={onClose} disabled={isPending}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </Button>
              </DialogFooter>
            </>
          )}
          {step === STEP.verifyNew && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t(($) => $['account.changeEmail.verifyNew'], { ns: 'accountSettings' })}
                </DialogTitle>
                <DialogHeaderCloseButton
                  disabled={isPending}
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                />
              </DialogHeader>
              <DialogBody>
                <div className="space-y-0.5 pt-1 pb-2">
                  <div className="body-md-regular text-text-secondary">
                    <Trans
                      i18nKey={($) => $['account.changeEmail.content4']}
                      ns="accountSettings"
                      components={{
                        email: <span className="body-md-medium text-text-primary"></span>,
                      }}
                      values={{ email: mail }}
                    />
                  </div>
                </div>
                <Field name="code" invalid={!!codeError} className="pt-3">
                  <FieldLabel>
                    {t(($) => $['account.changeEmail.codeLabel'], { ns: 'accountSettings' })}
                  </FieldLabel>
                  <Input
                    className="w-full!"
                    placeholder={t(($) => $['account.changeEmail.codePlaceholder'], {
                      ns: 'accountSettings',
                    })}
                    value={code}
                    onValueChange={(value) => {
                      setCode(value)
                      verifiedNewTokenRef.current = null
                      operation.reset()
                    }}
                    readOnly={isPending}
                    autoComplete="one-time-code"
                    maxLength={6}
                  />
                  {codeError && <FieldError match>{codeError}</FieldError>}
                </Field>
                {errorMessage && !codeError && (
                  <p role="alert" className="mt-3 system-sm-regular text-text-destructive">
                    {errorMessage}
                  </p>
                )}
              </DialogBody>
              <DialogFooter className="flex-col items-stretch">
                <Button
                  disabled={code.length !== 6}
                  variant="primary"
                  type="submit"
                  loading={isPending}
                >
                  {t(($) => $['account.changeEmail.changeTo'], {
                    ns: 'accountSettings',
                    email: mail,
                  })}
                </Button>
                <Button onClick={onClose} disabled={isPending}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </Button>
                <div className="flex items-center gap-1 system-xs-regular text-text-tertiary">
                  <span>
                    {t(($) => $['account.changeEmail.resendTip'], { ns: 'accountSettings' })}
                  </span>
                  {time > 0 && (
                    <span>
                      {t(($) => $['account.changeEmail.resendCount'], {
                        ns: 'accountSettings',
                        count: time,
                      })}
                    </span>
                  )}
                  {!time && (
                    <button
                      type="button"
                      onClick={() => runOperation('sendNew')}
                      disabled={isPending}
                      className="cursor-pointer rounded-sm system-xs-medium text-text-accent-secondary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    >
                      {t(($) => $['account.changeEmail.resend'], { ns: 'accountSettings' })}
                    </button>
                  )}
                </div>
              </DialogFooter>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
