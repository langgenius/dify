import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import { Button } from '@/app/components/base/ui/button'
import { toast } from '@/app/components/base/ui/toast'
import { useAppContext } from '@/context/app-context'
import { ownershipTransfer, sendOwnerEmail, verifyOwnerEmail } from '@/service/common'
import MemberSelector from './member-selector'

type Props = {
  show: boolean
  onClose: () => void
}
enum STEP {
  start = 'start',
  verify = 'verify',
  transfer = 'transfer',
}
const TransferOwnershipModal = ({ onClose, show }: Props) => {
  const { t } = useTranslation()
  const { currentWorkspace, userProfile } = useAppContext()
  const [step, setStep] = useState<STEP>(STEP.start)
  const [code, setCode] = useState<string>('')
  const [time, setTime] = useState<number>(0)
  const [stepToken, setStepToken] = useState<string>('')
  const [newOwner, setNewOwner] = useState<string>('')
  const [isTransfer, setIsTransfer] = useState<boolean>(false)
  const timerIdRef = React.useRef<number | undefined>(undefined)
  const retimeCountdown = useCallback((timerId?: number) => {
    if (timerIdRef.current !== undefined)
      window.clearInterval(timerIdRef.current)
    timerIdRef.current = timerId
  }, [])
  React.useEffect(() => {
    if (!show)
      retimeCountdown()
    return retimeCountdown
  }, [retimeCountdown, show])
  const startCount = () => {
    setTime(60)
    retimeCountdown(window.setInterval(() => {
      setTime((prev) => {
        if (prev <= 1) {
          retimeCountdown()
          return 0
        }
        return prev - 1
      })
    }, 1000))
  }
  const sendEmail = async () => {
    try {
      const res = await sendOwnerEmail({})
      startCount()
      if (res.data)
        setStepToken(res.data)
    }
    catch (error) {
      toast.error(`Error sending verification code: ${error ? (error as any).message : ''}`)
    }
  }
  const verifyEmailAddress = async (code: string, token: string, callback?: () => void) => {
    try {
      const res = await verifyOwnerEmail({
        code,
        token,
      })
      if (res.is_valid) {
        setStepToken(res.token)
        callback?.()
      }
      else {
        toast.error('Verifying email failed')
      }
    }
    catch (error) {
      toast.error(`Error verifying email: ${error ? (error as any).message : ''}`)
    }
  }
  const sendCodeToOriginEmail = async () => {
    await sendEmail()
    setStep(STEP.verify)
  }
  const handleVerifyOriginEmail = async () => {
    await verifyEmailAddress(code, stepToken, () => setStep(STEP.transfer))
    setCode('')
  }
  const handleTransfer = async () => {
    setIsTransfer(true)
    try {
      await ownershipTransfer(newOwner, {
        token: stepToken,
      })
      globalThis.location.reload()
    }
    catch (error) {
      toast.error(`Error ownership transfer: ${error ? (error as any).message : ''}`)
    }
    finally {
      setIsTransfer(false)
    }
  }
  return (
    <Modal isShow={show} onClose={noop} wrapperClassName="z-1002" className="w-[420px]! p-6!">
      <div data-testid="transfer-modal-close" className="absolute top-5 right-5 cursor-pointer p-1.5" onClick={onClose}>
        <div className="i-ri-close-line h-5 w-5 text-text-tertiary" />
      </div>
      {step === STEP.start && (
        <>
          <div className="pb-3 title-2xl-semi-bold text-text-primary">{t('members.transferModal.title', { ns: 'common' })}</div>
          <div className="space-y-1 pt-1 pb-2">
            <div className="body-md-medium text-text-destructive">{t('members.transferModal.warning', { ns: 'common', workspace: currentWorkspace.name.replace(/'/g, '’') })}</div>
            <div className="body-md-regular text-text-secondary">{t('members.transferModal.warningTip', { ns: 'common' })}</div>
            <div className="body-md-regular text-text-secondary">
              <Trans i18nKey="members.transferModal.sendTip" ns="common" components={{ email: <span className="body-md-medium text-text-primary"></span> }} values={{ email: userProfile.email }} />
            </div>
          </div>
          <div className="pt-3"></div>
          <div className="space-y-2">
            <Button data-testid="transfer-modal-send-code" className="w-full!" variant="primary" onClick={sendCodeToOriginEmail}>
              {t('members.transferModal.sendVerifyCode', { ns: 'common' })}
            </Button>
            <Button data-testid="transfer-modal-cancel" className="w-full!" onClick={onClose}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
          </div>
        </>
      )}
      {step === STEP.verify && (
        <>
          <div className="pb-3 title-2xl-semi-bold text-text-primary">{t('members.transferModal.verifyEmail', { ns: 'common' })}</div>
          <div className="pt-1 pb-2">
            <div className="body-md-regular text-text-secondary">
              <Trans i18nKey="members.transferModal.verifyContent" ns="common" components={{ email: <span className="body-md-medium text-text-primary"></span> }} values={{ email: userProfile.email }} />
            </div>
            <div className="body-md-regular text-text-secondary">{t('members.transferModal.verifyContent2', { ns: 'common' })}</div>
          </div>
          <div className="pt-3">
            <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">{t('members.transferModal.codeLabel', { ns: 'common' })}</div>
            <Input data-testid="transfer-modal-code-input" className="w-full!" placeholder={t('members.transferModal.codePlaceholder', { ns: 'common' })} value={code} onChange={e => setCode(e.target.value)} maxLength={6} />
          </div>
          <div className="mt-3 space-y-2">
            <Button data-testid="transfer-modal-continue" disabled={code.length !== 6} className="w-full!" variant="primary" onClick={handleVerifyOriginEmail}>
              {t('members.transferModal.continue', { ns: 'common' })}
            </Button>
            <Button data-testid="transfer-modal-cancel" className="w-full!" onClick={onClose}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-1 system-xs-regular text-text-tertiary">
            <span>{t('members.transferModal.resendTip', { ns: 'common' })}</span>
            {time > 0 && (<span>{t('members.transferModal.resendCount', { ns: 'common', count: time })}</span>)}
            {!time && (
              <span data-testid="transfer-modal-resend" onClick={sendCodeToOriginEmail} className="cursor-pointer system-xs-medium text-text-accent-secondary">
                {t('members.transferModal.resend', { ns: 'common' })}
              </span>
            )}
          </div>
        </>
      )}
      {step === STEP.transfer && (
        <>
          <div className="pb-3 title-2xl-semi-bold text-text-primary">{t('members.transferModal.title', { ns: 'common' })}</div>
          <div className="space-y-1 pt-1 pb-2">
            <div className="body-md-medium text-text-destructive">{t('members.transferModal.warning', { ns: 'common', workspace: currentWorkspace.name.replace(/'/g, '’') })}</div>
            <div className="body-md-regular text-text-secondary">{t('members.transferModal.warningTip', { ns: 'common' })}</div>
          </div>
          <div className="pt-3">
            <div className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary">{t('members.transferModal.transferLabel', { ns: 'common' })}</div>
            <MemberSelector exclude={[userProfile.id]} value={newOwner} onSelect={setNewOwner} />
          </div>
          <div className="mt-4 space-y-2">
            <Button data-testid="transfer-modal-submit" disabled={!newOwner || isTransfer} className="w-full!" variant="primary" tone="destructive" onClick={handleTransfer}>
              {t('members.transferModal.transfer', { ns: 'common' })}
            </Button>
            <Button data-testid="transfer-modal-cancel" className="w-full!" onClick={onClose}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
export default TransferOwnershipModal
