import type { ResponseError } from '@/service/fetch'
import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import {
  checkEmailExisted,
  resetEmail,
  sendVerifyCode,
  verifyEmail,
} from '@/service/common'
import { useLogout } from '@/service/use-common'
import { asyncRunSafe } from '@/utils'

type Props = {
  show: boolean
  onClose: () => void
  email: string
}

enum STEP {
  start = 'start',
  verifyOrigin = 'verifyOrigin',
  newEmail = 'newEmail',
  verifyNew = 'verifyNew',
}

const EmailChangeModal = ({ onClose, email, show }: Props) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const router = useRouter()
  const [step, setStep] = useState<STEP>(STEP.start)
  const [code, setCode] = useState<string>('')
  const [mail, setMail] = useState<string>('')
  const [time, setTime] = useState<number>(0)
  const [stepToken, setStepToken] = useState<string>('')
  const [newEmailExited, setNewEmailExited] = useState<boolean>(false)
  const [unAvailableEmail, setUnAvailableEmail] = useState<boolean>(false)
  const [isCheckingEmail, setIsCheckingEmail] = useState<boolean>(false)

  const startCount = () => {
    setTime(60)
    const timer = setInterval(() => {
      setTime((prev) => {
        if (prev <= 0) {
          clearInterval(timer)
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
      if (res.data)
        setStepToken(res.data)
    }
    catch (error) {
      notify({
        type: 'error',
        message: `Error sending verification code: ${error ? (error as any).message : ''}`,
      })
    }
  }

  const verifyEmailAddress = async (email: string, code: string, token: string, callback?: (data?: any) => void) => {
    try {
      const res = await verifyEmail({
        email,
        code,
        token,
      })
      if (res.is_valid) {
        setStepToken(res.token)
        callback?.(res.token)
      }
      else {
        notify({
          type: 'error',
          message: 'Verifying email failed',
        })
      }
    }
    catch (error) {
      notify({
        type: 'error',
        message: `Error verifying email: ${error ? (error as any).message : ''}`,
      })
    }
  }

  const sendCodeToOriginEmail = async () => {
    await sendEmail(
      email,
      true,
    )
    setStep(STEP.verifyOrigin)
  }

  const handleVerifyOriginEmail = async () => {
    await verifyEmailAddress(email, code, stepToken, () => setStep(STEP.newEmail))
    setCode('')
  }

  const isValidEmail = (email: string): boolean => {
    const rfc5322emailRegex = /^[\w.!#$%&'*+/=?^`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
    return rfc5322emailRegex.test(email) && email.length <= 254
  }

  const checkNewEmailExisted = async (email: string) => {
    setIsCheckingEmail(true)
    try {
      await checkEmailExisted({
        email,
      })
      setNewEmailExited(false)
      setUnAvailableEmail(false)
    }
    catch (e: any) {
      if (e.status === 400) {
        const [, errRespData] = await asyncRunSafe<ResponseError>(e.json())
        const { code } = errRespData || {}
        if (code === 'email_already_in_use')
          setNewEmailExited(true)
        if (code === 'account_in_freeze')
          setUnAvailableEmail(true)
      }
    }
    finally {
      setIsCheckingEmail(false)
    }
  }

  const handleNewEmailValueChange = (mailAddress: string) => {
    setMail(mailAddress)
    setNewEmailExited(false)
    if (isValidEmail(mailAddress))
      checkNewEmailExisted(mailAddress)
  }

  const sendCodeToNewEmail = async () => {
    if (!isValidEmail(mail)) {
      notify({
        type: 'error',
        message: 'Invalid email format',
      })
      return
    }
    await sendEmail(
      mail,
      false,
      stepToken,
    )
    setStep(STEP.verifyNew)
  }

  const { mutateAsync: logout } = useLogout()
  const handleLogout = async () => {
    await logout()

    localStorage.removeItem('setup_status')
    // Tokens are now stored in cookies and cleared by backend

    router.push('/signin')
  }

  const updateEmail = async (lastToken: string) => {
    try {
      await resetEmail({
        new_email: mail,
        token: lastToken,
      })
      handleLogout()
    }
    catch (error) {
      notify({
        type: 'error',
        message: `Error changing email: ${error ? (error as any).message : ''}`,
      })
    }
  }

  const submitNewEmail = async () => {
    await verifyEmailAddress(mail, code, stepToken, updateEmail)
  }

  return (
    <Modal
      isShow={show}
      onClose={noop}
      className="!w-[420px] !p-6"
    >
      <div className="absolute right-5 top-5 cursor-pointer p-1.5" onClick={onClose}>
        <RiCloseLine className="h-5 w-5 text-text-tertiary" />
      </div>
      {step === STEP.start && (
        <>
          <div className="title-2xl-semi-bold pb-3 text-text-primary">{t('account.changeEmail.title', { ns: 'common' })}</div>
          <div className="space-y-0.5 pb-2 pt-1">
            <div className="body-md-medium text-text-warning">{t('account.changeEmail.authTip', { ns: 'common' })}</div>
            <div className="body-md-regular text-text-secondary">
              <Trans
                i18nKey="account.changeEmail.content1"
                ns="common"
                components={{ email: <span className="body-md-medium text-text-primary"></span> }}
                values={{ email }}
              />
            </div>
          </div>
          <div className="pt-3"></div>
          <div className="space-y-2">
            <Button
              className="!w-full"
              variant="primary"
              onClick={sendCodeToOriginEmail}
            >
              {t('account.changeEmail.sendVerifyCode', { ns: 'common' })}
            </Button>
            <Button
              className="!w-full"
              onClick={onClose}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
          </div>
        </>
      )}
      {step === STEP.verifyOrigin && (
        <>
          <div className="title-2xl-semi-bold pb-3 text-text-primary">{t('account.changeEmail.verifyEmail', { ns: 'common' })}</div>
          <div className="space-y-0.5 pb-2 pt-1">
            <div className="body-md-regular text-text-secondary">
              <Trans
                i18nKey="account.changeEmail.content2"
                ns="common"
                components={{ email: <span className="body-md-medium text-text-primary"></span> }}
                values={{ email }}
              />
            </div>
          </div>
          <div className="pt-3">
            <div className="system-sm-medium mb-1 flex h-6 items-center text-text-secondary">{t('account.changeEmail.codeLabel', { ns: 'common' })}</div>
            <Input
              className="!w-full"
              placeholder={t('account.changeEmail.codePlaceholder', { ns: 'common' })}
              value={code}
              onChange={e => setCode(e.target.value)}
              maxLength={6}
            />
          </div>
          <div className="mt-3 space-y-2">
            <Button
              disabled={code.length !== 6}
              className="!w-full"
              variant="primary"
              onClick={handleVerifyOriginEmail}
            >
              {t('account.changeEmail.continue', { ns: 'common' })}
            </Button>
            <Button
              className="!w-full"
              onClick={onClose}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
          </div>
          <div className="system-xs-regular mt-3 flex items-center gap-1 text-text-tertiary">
            <span>{t('account.changeEmail.resendTip', { ns: 'common' })}</span>
            {time > 0 && (
              <span>{t('account.changeEmail.resendCount', { ns: 'common', count: time })}</span>
            )}
            {!time && (
              <span onClick={sendCodeToOriginEmail} className="system-xs-medium cursor-pointer text-text-accent-secondary">{t('account.changeEmail.resend', { ns: 'common' })}</span>
            )}
          </div>
        </>
      )}
      {step === STEP.newEmail && (
        <>
          <div className="title-2xl-semi-bold pb-3 text-text-primary">{t('account.changeEmail.newEmail', { ns: 'common' })}</div>
          <div className="space-y-0.5 pb-2 pt-1">
            <div className="body-md-regular text-text-secondary">{t('account.changeEmail.content3', { ns: 'common' })}</div>
          </div>
          <div className="pt-3">
            <div className="system-sm-medium mb-1 flex h-6 items-center text-text-secondary">{t('account.changeEmail.emailLabel', { ns: 'common' })}</div>
            <Input
              className="!w-full"
              placeholder={t('account.changeEmail.emailPlaceholder', { ns: 'common' })}
              value={mail}
              onChange={e => handleNewEmailValueChange(e.target.value)}
              destructive={newEmailExited || unAvailableEmail}
            />
            {newEmailExited && (
              <div className="body-xs-regular mt-1 py-0.5 text-text-destructive">{t('account.changeEmail.existingEmail', { ns: 'common' })}</div>
            )}
            {unAvailableEmail && (
              <div className="body-xs-regular mt-1 py-0.5 text-text-destructive">{t('account.changeEmail.unAvailableEmail', { ns: 'common' })}</div>
            )}
          </div>
          <div className="mt-3 space-y-2">
            <Button
              disabled={!mail || newEmailExited || unAvailableEmail || isCheckingEmail || !isValidEmail(mail)}
              className="!w-full"
              variant="primary"
              onClick={sendCodeToNewEmail}
            >
              {t('account.changeEmail.sendVerifyCode', { ns: 'common' })}
            </Button>
            <Button
              className="!w-full"
              onClick={onClose}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
          </div>
        </>
      )}
      {step === STEP.verifyNew && (
        <>
          <div className="title-2xl-semi-bold pb-3 text-text-primary">{t('account.changeEmail.verifyNew', { ns: 'common' })}</div>
          <div className="space-y-0.5 pb-2 pt-1">
            <div className="body-md-regular text-text-secondary">
              <Trans
                i18nKey="account.changeEmail.content4"
                ns="common"
                components={{ email: <span className="body-md-medium text-text-primary"></span> }}
                values={{ email: mail }}
              />
            </div>
          </div>
          <div className="pt-3">
            <div className="system-sm-medium mb-1 flex h-6 items-center text-text-secondary">{t('account.changeEmail.codeLabel', { ns: 'common' })}</div>
            <Input
              className="!w-full"
              placeholder={t('account.changeEmail.codePlaceholder', { ns: 'common' })}
              value={code}
              onChange={e => setCode(e.target.value)}
              maxLength={6}
            />
          </div>
          <div className="mt-3 space-y-2">
            <Button
              disabled={code.length !== 6}
              className="!w-full"
              variant="primary"
              onClick={submitNewEmail}
            >
              {t('account.changeEmail.changeTo', { ns: 'common', email: mail })}
            </Button>
            <Button
              className="!w-full"
              onClick={onClose}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
          </div>
          <div className="system-xs-regular mt-3 flex items-center gap-1 text-text-tertiary">
            <span>{t('account.changeEmail.resendTip', { ns: 'common' })}</span>
            {time > 0 && (
              <span>{t('account.changeEmail.resendCount', { ns: 'common', count: time })}</span>
            )}
            {!time && (
              <span onClick={sendCodeToNewEmail} className="system-xs-medium cursor-pointer text-text-accent-secondary">{t('account.changeEmail.resend', { ns: 'common' })}</span>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

export default EmailChangeModal
