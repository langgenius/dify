import React, { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import { noop } from 'lodash-es'

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
  const [step, setStep] = useState<STEP>(STEP.start)
  const [code, setCode] = useState<string>('')
  const [mail, setMail] = useState<string>('jin_zehong@qq.com')
  const [time, setTime] = useState<number>(0)

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
          <div className='title-2xl-semi-bold pb-3 text-text-primary'>{t('common.account.changeEmail.title')}</div>
          <div className='space-y-0.5 pb-2 pt-1'>
            <div className='body-md-medium text-text-warning'>{t('common.account.changeEmail.authTip')}</div>
            <div className='body-md-regular text-text-secondary'>
              <Trans
                i18nKey="common.account.changeEmail.content1"
                components={{ email: <span className='body-md-medium text-text-primary'></span> }}
                values={{ email }}
              />
            </div>
          </div>
          <div className='pt-3'></div>
          <div className='space-y-2'>
            <Button
              className='!w-full'
              variant='primary'
              onClick={() => setStep(STEP.verifyOrigin)}
            >
              {t('common.account.changeEmail.sendVerifyCode')}
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
      {step === STEP.verifyOrigin && (
        <>
          <div className='title-2xl-semi-bold pb-3 text-text-primary'>{t('common.account.changeEmail.verifyEmail')}</div>
          <div className='space-y-0.5 pb-2 pt-1'>
            <div className='body-md-regular text-text-secondary'>
              <Trans
                i18nKey="common.account.changeEmail.content2"
                components={{ email: <span className='body-md-medium text-text-primary'></span> }}
                values={{ email }}
              />
            </div>
          </div>
          <div className='pt-3'>
            <div className='system-sm-medium mb-1 flex h-6 items-center text-text-secondary'>{t('common.account.changeEmail.codeLabel')}</div>
            <Input
              className='!w-full'
              placeholder={t('common.account.changeEmail.codePlaceholder')}
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
              onClick={() => setStep(STEP.newEmail)}
            >
              {t('common.account.changeEmail.continue')}
            </Button>
            <Button
              className='!w-full'
              onClick={onClose}
            >
              {t('common.operation.cancel')}
            </Button>
          </div>
          <div className='system-xs-regular mt-3 flex items-center gap-1 text-text-tertiary'>
            <span>{t('common.account.changeEmail.resendTip')}</span>
            {time > 0 && (
              <span>{t('common.account.changeEmail.resendCount', { count: time })}</span>
            )}
            {!time && (
              <span onClick={startCount} className='system-xs-medium cursor-pointer text-text-accent-secondary'>{t('common.account.changeEmail.resend')}</span>
            )}
          </div>
        </>
      )}
      {step === STEP.newEmail && (
        <>
          <div className='title-2xl-semi-bold pb-3 text-text-primary'>{t('common.account.changeEmail.newEmail')}</div>
          <div className='space-y-0.5 pb-2 pt-1'>
            <div className='body-md-regular text-text-secondary'>{t('common.account.changeEmail.content3')}</div>
          </div>
          <div className='pt-3'>
            <div className='system-sm-medium mb-1 flex h-6 items-center text-text-secondary'>{t('common.account.changeEmail.emailLabel')}</div>
            <Input
              className='!w-full'
              placeholder={t('common.account.changeEmail.emailPlaceholder')}
              value={mail}
              onChange={e => setMail(e.target.value)}
              destructive
            />
            <div className='body-xs-regular mt-1 py-0.5 text-text-destructive'>{t('common.account.changeEmail.existingEmail')}</div>
          </div>
          <div className='mt-3 space-y-2'>
            <Button
              disabled={!mail}
              className='!w-full'
              variant='primary'
              onClick={() => setStep(STEP.verifyNew)}
            >
              {t('common.account.changeEmail.sendVerifyCode')}
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
      {step === STEP.verifyNew && (
        <>
          <div className='title-2xl-semi-bold pb-3 text-text-primary'>{t('common.account.changeEmail.verifyNew')}</div>
          <div className='space-y-0.5 pb-2 pt-1'>
            <div className='body-md-regular text-text-secondary'>
              <Trans
                i18nKey="common.account.changeEmail.content4"
                components={{ email: <span className='body-md-medium text-text-primary'></span> }}
                values={{ email: mail }}
              />
            </div>
          </div>
          <div className='pt-3'>
            <div className='system-sm-medium mb-1 flex h-6 items-center text-text-secondary'>{t('common.account.changeEmail.codeLabel')}</div>
            <Input
              className='!w-full'
              placeholder={t('common.account.changeEmail.codePlaceholder')}
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
              onClick={onClose}
            >
              {t('common.account.changeEmail.changeTo', { email: mail })}
            </Button>
            <Button
              className='!w-full'
              onClick={onClose}
            >
              {t('common.operation.cancel')}
            </Button>
          </div>
          <div className='system-xs-regular mt-3 flex items-center gap-1 text-text-tertiary'>
            <span>{t('common.account.changeEmail.resendTip')}</span>
            {time > 0 && (
              <span>{t('common.account.changeEmail.resendCount', { count: time })}</span>
            )}
            {!time && (
              <span onClick={startCount} className='system-xs-medium cursor-pointer text-text-accent-secondary'>{t('common.account.changeEmail.resend')}</span>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

export default EmailChangeModal
