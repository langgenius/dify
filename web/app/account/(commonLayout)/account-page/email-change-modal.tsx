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
import { useDebounceFn } from 'ahooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleClient } from '@/service/console'
import { useLogout } from '@/service/use-common'
import { getErrorMessage } from '@/utils/error-message'

type Props = {
  onClose: () => void
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

const EmailChangeModal = ({ onClose, email }: Props) => {
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
      const res = await consoleClient.account.changeEmail.post({
        body: { email, phase: isOrigin ? 'old_email' : 'new_email', token },
      })
      startCount()
      if (res.data) setStepToken(res.data)
    } catch (error) {
      toast.error(`Error sending verification code: ${getErrorMessage(error) ?? ''}`)
    }
  }

  const verifyEmailAddress = async (
    email: string,
    code: string,
    token: string,
    callback?: (token: string) => void,
  ) => {
    try {
      const res = await consoleClient.account.changeEmail.validity.post({
        body: { email, code, token },
      })
      if (res.is_valid) {
        setStepToken(res.token)
        callback?.(res.token)
      } else {
        toast.error('Verifying email failed')
      }
    } catch (error) {
      toast.error(`Error verifying email: ${getErrorMessage(error) ?? ''}`)
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
      await consoleClient.account.changeEmail.checkEmailUnique.post(
        { body: { email } },
        { context: { silent: true } },
      )
      if (latestEmailRef.current !== email) return
      setNewEmailExited(false)
      setUnAvailableEmail(false)
    } catch (e: unknown) {
      if (latestEmailRef.current !== email) return
      if (e instanceof ORPCError && e.status === 400) {
        const { code } = e
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
      await consoleClient.account.changeEmail.reset.post({
        body: { new_email: mail.trim(), token: lastToken },
      })
      await logout()
    } catch (error) {
      toast.error(`Error changing email: ${getErrorMessage(error) ?? ''}`)
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-105">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            if (step === STEP.start) void sendCodeToOriginEmail()
            else if (step === STEP.verifyOrigin) void handleVerifyOriginEmail()
            else if (step === STEP.newEmail) void sendCodeToNewEmail()
            else void submitNewEmail()
          }}
        >
          {step === STEP.start && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t(($) => $['account.changeEmail.title'], { ns: 'accountSettings' })}
                </DialogTitle>
                <DialogHeaderCloseButton
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
              </DialogBody>
              <DialogFooter className="flex-col items-stretch">
                <Button variant="primary" type="submit">
                  {t(($) => $['account.changeEmail.sendVerifyCode'], { ns: 'accountSettings' })}
                </Button>
                <Button onClick={onClose}>
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
              </DialogBody>
              <DialogFooter className="flex-col items-stretch">
                <Button disabled={code.length !== 6} variant="primary" type="submit">
                  {t(($) => $['account.changeEmail.continue'], { ns: 'accountSettings' })}
                </Button>
                <Button onClick={onClose}>
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
                      onClick={sendCodeToOriginEmail}
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
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                />
              </DialogHeader>
              <DialogBody>
                <div className="space-y-0.5 pt-1 pb-2">
                  <div className="body-md-regular text-text-secondary">
                    {t(($) => $['account.changeEmail.content3'], { ns: 'accountSettings' })}
                  </div>
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
                      {t(($) => $['account.changeEmail.unAvailableEmail'], {
                        ns: 'accountSettings',
                      })}
                    </FieldError>
                  )}
                </Field>
              </DialogBody>
              <DialogFooter className="flex-col items-stretch">
                <Button disabled={isSendCodeDisabled} variant="primary" type="submit">
                  {t(($) => $['account.changeEmail.sendVerifyCode'], { ns: 'accountSettings' })}
                </Button>
                <Button onClick={onClose}>
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
              </DialogBody>
              <DialogFooter className="flex-col items-stretch">
                <Button disabled={code.length !== 6} variant="primary" type="submit">
                  {t(($) => $['account.changeEmail.changeTo'], {
                    ns: 'accountSettings',
                    email: mail,
                  })}
                </Button>
                <Button onClick={onClose}>
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
                      onClick={sendCodeToNewEmail}
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

export default EmailChangeModal
