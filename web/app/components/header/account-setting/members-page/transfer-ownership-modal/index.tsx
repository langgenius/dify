import React, { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { RiCloseLine } from '@remixicon/react'
import { useAppContext } from '@/context/app-context'
import { ToastContext } from '@/app/components/base/toast'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import MemberSelector from './member-selector'
import {
  ownershipTransfer,
  sendOwnerEmail,
  verifyOwnerEmail,
} from '@/service/common'
import { noop } from 'lodash-es'

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
  const { notify } = useContext(ToastContext)
  const { currentWorkspace, userProfile } = useAppContext()
  const [step, setStep] = useState<STEP>(STEP.start)
  const [code, setCode] = useState<string>('')
  const [time, setTime] = useState<number>(0)
  const [stepToken, setStepToken] = useState<string>('')
  const [newOwner, setNewOwner] = useState<string>('')
  const [isTransfer, setIsTransfer] = useState<boolean>(false)

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

  const sendEmail = async () => {
    try {
      const res = await sendOwnerEmail({})
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
      await ownershipTransfer(
        newOwner,
        {
          token: stepToken,
        },
      )
      globalThis.location.reload()
    }
    catch (error) {
      notify({
        type: 'error',
        message: `Error ownership transfer: ${error ? (error as any).message : ''}`,
      })
    }
    finally {
      setIsTransfer(false)
    }
  }

  return (
    <Modal
      isShow={show}
      onClose={noop}
      className='!w-[420px] !p-6'
    >
      <div className='absolute right-5 top-5 cursor-pointer p-1.5' onClick={onClose}>
        <RiCloseLine className='h-5 w-5 text-text-tertiary' />
      </div>
      {step === STEP.start && (
        <>
          <div className='title-2xl-semi-bold pb-3 text-text-primary'>{t('common.members.transferModal.title')}</div>
          <div className='space-y-1 pb-2 pt-1'>
            <div className='body-md-medium text-text-destructive'>{t('common.members.transferModal.warning', { workspace: currentWorkspace.name.replace(/'/g, '’') })}</div>
            <div className='body-md-regular text-text-secondary'>{t('common.members.transferModal.warningTip')}</div>
            <div className='body-md-regular text-text-secondary'>
              <Trans
                i18nKey="common.members.transferModal.sendTip"
                components={{ email: <span className='body-md-medium text-text-primary'></span> }}
                values={{ email: userProfile.email }}
              />
            </div>
          </div>
          <div className='pt-3'></div>
          <div className='space-y-2'>
            <Button
              className='!w-full'
              variant='primary'
              onClick={sendCodeToOriginEmail}
            >
              {t('common.members.transferModal.sendVerifyCode')}
            </Button>
            <Button
              className='!w-full'
              onClick={onClose}
            >
              {t('common.operation.cancel')}
            </Button>
          </div>
        </>
      )}
      {step === STEP.verify && (
        <>
          <div className='title-2xl-semi-bold pb-3 text-text-primary'>{t('common.members.transferModal.verifyEmail')}</div>
          <div className='pb-2 pt-1'>
            <div className='body-md-regular text-text-secondary'>
              <Trans
                i18nKey="common.members.transferModal.verifyContent"
                components={{ email: <span className='body-md-medium text-text-primary'></span> }}
                values={{ email: userProfile.email }}
              />
            </div>
            <div className='body-md-regular text-text-secondary'>{t('common.members.transferModal.verifyContent2')}</div>
          </div>
          <div className='pt-3'>
            <div className='system-sm-medium mb-1 flex h-6 items-center text-text-secondary'>{t('common.members.transferModal.codeLabel')}</div>
            <Input
              className='!w-full'
              placeholder={t('common.members.transferModal.codePlaceholder')}
              value={code}
              onChange={e => setCode(e.target.value)}
              maxLength={6}
            />
          </div>
          <div className='mt-3 space-y-2'>
            <Button
              disabled={code.length !== 6}
              className='!w-full'
              variant='primary'
              onClick={handleVerifyOriginEmail}
            >
              {t('common.members.transferModal.continue')}
            </Button>
            <Button
              className='!w-full'
              onClick={onClose}
            >
              {t('common.operation.cancel')}
            </Button>
          </div>
          <div className='system-xs-regular mt-3 flex items-center gap-1 text-text-tertiary'>
            <span>{t('common.members.transferModal.resendTip')}</span>
            {time > 0 && (
              <span>{t('common.members.transferModal.resendCount', { count: time })}</span>
            )}
            {!time && (
              <span onClick={sendCodeToOriginEmail} className='system-xs-medium cursor-pointer text-text-accent-secondary'>{t('common.members.transferModal.resend')}</span>
            )}
          </div>
        </>
      )}
      {step === STEP.transfer && (
        <>
          <div className='title-2xl-semi-bold pb-3 text-text-primary'>{t('common.members.transferModal.title')}</div>
          <div className='space-y-1 pb-2 pt-1'>
            <div className='body-md-medium text-text-destructive'>{t('common.members.transferModal.warning', { workspace: currentWorkspace.name.replace(/'/g, '’') })}</div>
            <div className='body-md-regular text-text-secondary'>{t('common.members.transferModal.warningTip')}</div>
          </div>
          <div className='pt-3'>
            <div className='system-sm-medium mb-1 flex h-6 items-center text-text-secondary'>{t('common.members.transferModal.transferLabel')}</div>
            <MemberSelector
              exclude={[userProfile.id]}
              value={newOwner}
              onSelect={setNewOwner}
            />
          </div>
          <div className='mt-4 space-y-2'>
            <Button
              disabled={!newOwner || isTransfer}
              className='!w-full'
              variant='warning'
              onClick={handleTransfer}
            >
              {t('common.members.transferModal.transfer')}
            </Button>
            <Button
              className='!w-full'
              onClick={onClose}
            >
              {t('common.operation.cancel')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

export default TransferOwnershipModal
