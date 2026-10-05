import type { ResponseError } from '@/service/fetch'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { useDebounceFn } from 'ahooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { checkEmailExisted, resetEmail, sendVerifyCode, verifyEmail } from '@/service/common'
import { useLogout } from '@/service/use-common'
import { asyncRunSafe } from '@/utils'

type Props = {
  email: string
}

const STEP = {
  start: 'start',
  verifyOrigin: 'verifyOrigin',
  newEmail: 'newEmail',
  verifyNew: 'verifyNew',
} as const

type Step = (typeof STEP)[keyof typeof STEP]

const emailPattern = /^[\w.!#$%&'*+\-/=?^`{|}~]+@(?:[\w-]+\.)+[\w-]{2,}$/

type FetchResponseError = {
  status: number
  json: () => Promise<ResponseError>
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    return typeof message === 'string' ? message : ''
  }
  return ''
}

function isFetchResponseError(error: unknown): error is FetchResponseError {
  if (typeof error !== 'object' || error === null) return false

  const maybeError = error as { status?: unknown; json?: unknown }
  return typeof maybeError.status === 'number' && typeof maybeError.json === 'function'
}

export function EmailChangeModal({ email }: Props) {
  const { t } = useTranslation(['common'])
  return (
    <Dialog>
      <DialogTrigger className="cursor-pointer rounded-lg bg-components-button-tertiary-bg px-3 py-2 system-sm-medium text-components-button-tertiary-text outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid">
        {t(($) => $['operation.change'])}
      </DialogTrigger>
      <DialogContent className="w-105! p-6!">
        <EmailChangeForm email={email} />
      </DialogContent>
    </Dialog>
  )
}

function EmailChangeForm({ email }: Props) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const [step, setStep] = useState<Step>(STEP.start)
  const [code, setCode] = useState<string>('')
  const [mail, setMail] = useState<string>('')
  const [time, setTime] = useState<number>(0)
  const [stepToken, setStepToken] = useState<string>('')
  const [newEmailExited, setNewEmailExited] = useState<boolean>(false)
  const [unAvailableEmail, setUnAvailableEmail] = useState<boolean>(false)
  const [isCheckingEmail, setIsCheckingEmail] = useState<boolean>(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const latestEmailRef = useRef<string>('')
  const isMountedRef = useRef(false)

  const clearCountdown = useCallback(() => {
    if (!timerRef.current) return

    clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      clearCountdown()
    }
  }, [clearCountdown])

  const startCount = () => {
    if (!isMountedRef.current) return
    clearCountdown()
    setTime(60)
    timerRef.current = setInterval(() => {
      setTime((prev) => {
        if (prev <= 1) {
          clearCountdown()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const sendEmail = async (email: string, isOrigin: boolean, token?: string) => {
    try {
      const res = await sendVerifyCode({
        email,
        phase: isOrigin ? 'old_email' : 'new_email',
        token,
      })
      startCount()
      if (res.data) setStepToken(res.data)
    } catch (error) {
      toast.error(`Error sending verification code: ${getErrorMessage(error)}`)
    }
  }

  const verifyEmailAddress = async (
    email: string,
    code: string,
    token: string,
    callback?: (token: string) => void,
  ) => {
    try {
      const res = await verifyEmail({
        email,
        code,
        token,
      })
      if (res.is_valid) {
        setStepToken(res.token)
        callback?.(res.token)
      } else {
        toast.error('Verifying email failed')
      }
    } catch (error) {
      toast.error(`Error verifying email: ${getErrorMessage(error)}`)
    }
  }

  const sendCodeToOriginEmail = async () => {
    await sendEmail(email, true)
    setStep(STEP.verifyOrigin)
  }

  const handleVerifyOriginEmail = async () => {
    await verifyEmailAddress(email, code, stepToken, () => setStep(STEP.newEmail))
    setCode('')
  }

  const isValidEmail = (email: string): boolean => {
    return emailPattern.test(email)
  }

  const checkNewEmailExisted = async (email: string) => {
    setIsCheckingEmail(true)
    try {
      await checkEmailExisted({
        email,
      })
      if (latestEmailRef.current !== email) return
      setNewEmailExited(false)
      setUnAvailableEmail(false)
    } catch (e: unknown) {
      if (latestEmailRef.current !== email) return
      if (isFetchResponseError(e) && e.status === 400) {
        const [, errRespData] = await asyncRunSafe<ResponseError>(e.json())
        const { code } = errRespData || {}
        if (code === 'email_already_in_use') setNewEmailExited(true)
        if (code === 'account_in_freeze') setUnAvailableEmail(true)
      }
    } finally {
      if (latestEmailRef.current === email) setIsCheckingEmail(false)
    }
  }

  const { run: checkNewEmailExistedDebounced, cancel: cancelCheckNewEmailExisted } = useDebounceFn(
    checkNewEmailExisted,
    { wait: 500 },
  )

  useEffect(() => cancelCheckNewEmailExisted, [cancelCheckNewEmailExisted])

  const handleNewEmailValueChange = (mailAddress: string) => {
    const normalizedMailAddress = mailAddress.trim()
    latestEmailRef.current = normalizedMailAddress
    setMail(mailAddress)
    setNewEmailExited(false)
    setUnAvailableEmail(false)
    if (isValidEmail(normalizedMailAddress)) {
      setIsCheckingEmail(true)
      checkNewEmailExistedDebounced(normalizedMailAddress)
      return
    }
    cancelCheckNewEmailExisted()
    setIsCheckingEmail(false)
  }

  const sendCodeToNewEmail = async () => {
    const normalizedMail = mail.trim()
    if (!isValidEmail(normalizedMail)) {
      toast.error('Invalid email format')
      return
    }
    await sendEmail(normalizedMail, false, stepToken)
    setStep(STEP.verifyNew)
  }

  const { mutateAsync: logout } = useLogout()
  const updateEmail = async (lastToken: string) => {
    try {
      await resetEmail({
        new_email: mail.trim(),
        token: lastToken,
      })
      await logout()
    } catch (error) {
      toast.error(`Error changing email: ${getErrorMessage(error)}`)
    }
  }

  const submitNewEmail = async () => {
    await verifyEmailAddress(mail.trim(), code, stepToken, updateEmail)
  }

  const normalizedMail = mail.trim()
  const isMailValid = isValidEmail(normalizedMail)
  const isSendCodeDisabled =
    !normalizedMail || newEmailExited || unAvailableEmail || isCheckingEmail || !isMailValid

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (step === STEP.start) void sendCodeToOriginEmail()
        else if (step === STEP.verifyOrigin) void handleVerifyOriginEmail()
        else if (step === STEP.newEmail) void sendCodeToNewEmail()
        else void submitNewEmail()
      }}
    >
      <DialogClose
        render={
          <IconButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            className="absolute top-5 right-5 size-8"
          >
            <span aria-hidden className="i-ri-close-line size-5 text-text-tertiary" />
          </IconButton>
        }
      />
      {step === STEP.start && (
        <>
          <DialogTitle className="pb-3 title-2xl-semi-bold text-text-primary">
            {t(($) => $['account.changeEmail.title'], { ns: 'accountSettings' })}
          </DialogTitle>
          <div className="space-y-0.5 pt-1 pb-2">
            <div className="body-md-medium text-text-warning">
              {t(($) => $['account.changeEmail.authTip'], { ns: 'accountSettings' })}
            </div>
            <DialogDescription className="body-md-regular text-text-secondary">
              <Trans
                i18nKey={($) => $['account.changeEmail.content1']}
                ns="accountSettings"
                components={{
                  email: <span className="body-md-medium text-text-primary"></span>,
                }}
                values={{ email }}
              />
            </DialogDescription>
          </div>
          <div className="pt-3"></div>
          <div className="space-y-2">
            <Button className="w-full!" variant="primary" type="submit">
              {t(($) => $['account.changeEmail.sendVerifyCode'], { ns: 'accountSettings' })}
            </Button>
            <DialogClose render={<Button className="w-full!" />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
          </div>
        </>
      )}
      {step === STEP.verifyOrigin && (
        <>
          <DialogTitle className="pb-3 title-2xl-semi-bold text-text-primary">
            {t(($) => $['account.changeEmail.verifyEmail'], { ns: 'accountSettings' })}
          </DialogTitle>
          <div className="space-y-0.5 pt-1 pb-2">
            <DialogDescription className="body-md-regular text-text-secondary">
              <Trans
                i18nKey={($) => $['account.changeEmail.content2']}
                ns="accountSettings"
                components={{
                  email: <span className="body-md-medium text-text-primary"></span>,
                }}
                values={{ email }}
              />
            </DialogDescription>
          </div>
          <Field name="code" className="pt-3">
            <FieldLabel>
              {t(($) => $['account.changeEmail.codeLabel'], { ns: 'accountSettings' })}
            </FieldLabel>
            <Input
              className="w-full!"
              placeholder={t(($) => $['account.changeEmail.codePlaceholder'], {
                ns: 'accountSettings',
              })}
              value={code}
              onValueChange={(value) => setCode(value)}
              autoComplete="one-time-code"
              maxLength={6}
            />
          </Field>
          <div className="mt-3 space-y-2">
            <Button
              disabled={code.length !== 6}
              className="w-full!"
              variant="primary"
              type="submit"
            >
              {t(($) => $['account.changeEmail.continue'], { ns: 'accountSettings' })}
            </Button>
            <DialogClose render={<Button className="w-full!" />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
          </div>
          <div className="mt-3 flex items-center gap-1 system-xs-regular text-text-tertiary">
            <span>{t(($) => $['account.changeEmail.resendTip'], { ns: 'accountSettings' })}</span>
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
                onClick={sendCodeToOriginEmail}
                className="cursor-pointer rounded-sm system-xs-medium text-text-accent-secondary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              >
                {t(($) => $['account.changeEmail.resend'], { ns: 'accountSettings' })}
              </button>
            )}
          </div>
        </>
      )}
      {step === STEP.newEmail && (
        <>
          <DialogTitle className="pb-3 title-2xl-semi-bold text-text-primary">
            {t(($) => $['account.changeEmail.newEmail'], { ns: 'accountSettings' })}
          </DialogTitle>
          <div className="space-y-0.5 pt-1 pb-2">
            <DialogDescription className="body-md-regular text-text-secondary">
              {t(($) => $['account.changeEmail.content3'], { ns: 'accountSettings' })}
            </DialogDescription>
          </div>
          <Field name="email" invalid={newEmailExited || unAvailableEmail} className="pt-3">
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
              autoComplete="email"
            />
            {newEmailExited && (
              <FieldError match>
                {t(($) => $['account.changeEmail.existingEmail'], { ns: 'accountSettings' })}
              </FieldError>
            )}
            {unAvailableEmail && (
              <FieldError match>
                {t(($) => $['account.changeEmail.unAvailableEmail'], { ns: 'accountSettings' })}
              </FieldError>
            )}
          </Field>
          <div className="mt-3 space-y-2">
            <Button
              disabled={isSendCodeDisabled}
              className="w-full!"
              variant="primary"
              type="submit"
            >
              {t(($) => $['account.changeEmail.sendVerifyCode'], { ns: 'accountSettings' })}
            </Button>
            <DialogClose render={<Button className="w-full!" />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
          </div>
        </>
      )}
      {step === STEP.verifyNew && (
        <>
          <DialogTitle className="pb-3 title-2xl-semi-bold text-text-primary">
            {t(($) => $['account.changeEmail.verifyNew'], { ns: 'accountSettings' })}
          </DialogTitle>
          <div className="space-y-0.5 pt-1 pb-2">
            <DialogDescription className="body-md-regular text-text-secondary">
              <Trans
                i18nKey={($) => $['account.changeEmail.content4']}
                ns="accountSettings"
                components={{
                  email: <span className="body-md-medium text-text-primary"></span>,
                }}
                values={{ email: mail }}
              />
            </DialogDescription>
          </div>
          <Field name="code" className="pt-3">
            <FieldLabel>
              {t(($) => $['account.changeEmail.codeLabel'], { ns: 'accountSettings' })}
            </FieldLabel>
            <Input
              className="w-full!"
              placeholder={t(($) => $['account.changeEmail.codePlaceholder'], {
                ns: 'accountSettings',
              })}
              value={code}
              onValueChange={(value) => setCode(value)}
              autoComplete="one-time-code"
              maxLength={6}
            />
          </Field>
          <div className="mt-3 space-y-2">
            <Button
              disabled={code.length !== 6}
              className="w-full!"
              variant="primary"
              type="submit"
            >
              {t(($) => $['account.changeEmail.changeTo'], {
                ns: 'accountSettings',
                email: mail,
              })}
            </Button>
            <DialogClose render={<Button className="w-full!" />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
          </div>
          <div className="mt-3 flex items-center gap-1 system-xs-regular text-text-tertiary">
            <span>{t(($) => $['account.changeEmail.resendTip'], { ns: 'accountSettings' })}</span>
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
                onClick={sendCodeToNewEmail}
                className="cursor-pointer rounded-sm system-xs-medium text-text-accent-secondary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              >
                {t(($) => $['account.changeEmail.resend'], { ns: 'accountSettings' })}
              </button>
            )}
          </div>
        </>
      )}
    </form>
  )
}
