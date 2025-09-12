'use client'
import React from 'react'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { useDocLink } from '@/context/i18n'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { RiExternalLinkLine } from '@remixicon/react'
import { SparklesSoftAccent } from '../components/base/icons/src/public/common'
import useTimestamp from '@/hooks/use-timestamp'
import { useModalContextSelector } from '@/context/modal-context'
import { useEducationVerify } from '@/service/use-education'
import { useRouter } from 'next/navigation'

export type ExpireNoticeModalPayloadProps = {
  expireAt: number
  expired: boolean
}
export type Props = {
  onClose: () => void
} & ExpireNoticeModalPayloadProps

const i18nPrefix = 'education.notice'

const ExpireNoticeModal: React.FC<Props> = ({ expireAt, expired, onClose }) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const eduDocLink = docLink('/getting-started/dify-for-education')
  const { formatTime } = useTimestamp()
  const setShowPricingModal = useModalContextSelector(s => s.setShowPricingModal)
  const { mutateAsync } = useEducationVerify()
  const router = useRouter()
  const handleVerify = async () => {
    const { token } = await mutateAsync()
    if (token)
      router.push(`/education-apply?token=${token}`)
  }
  const handleConfirm = async () => {
    await handleVerify()
    onClose()
  }

  return (
    <Modal
      isShow
      onClose={onClose}
      title={expired ? t(`${i18nPrefix}.expired.title`) : t(`${i18nPrefix}.isAboutToExpire.title`, { date: formatTime(expireAt, t(`${i18nPrefix}.dateFormat`) as string), interpolation: { escapeValue: false } })}
      closable
      className='max-w-[600px]'
    >
      <div className='body-md-regular mt-5 space-y-5 text-text-secondary'>
        <div>
          {expired ? (<>
            <div>{t(`${i18nPrefix}.expired.summary.line1`)}</div>
            <div>{t(`${i18nPrefix}.expired.summary.line2`)}</div>
          </>
          ) : t(`${i18nPrefix}.isAboutToExpire.summary`)}
        </div>
        <div>
          <strong className='title-md-semi-bold block'>{t(`${i18nPrefix}.stillInEducation.title`)}</strong>
          {t(`${i18nPrefix}.stillInEducation.${expired ? 'expired' : 'isAboutToExpire'}`)}
        </div>
        <div>
          <strong className='title-md-semi-bold block'>{t(`${i18nPrefix}.alreadyGraduated.title`)}</strong>
          {t(`${i18nPrefix}.alreadyGraduated.${expired ? 'expired' : 'isAboutToExpire'}`)}
        </div>
      </div>
      <div className="mt-7 flex items-center justify-between space-x-2">
        <Link className='system-xs-regular flex items-center space-x-1 text-text-accent' href={eduDocLink} target="_blank" rel="noopener noreferrer">
          <div>{t('education.learn')}</div>
          <RiExternalLinkLine className='size-3' />
        </Link>
        <div className='flex space-x-2'>
          {expired ? (
            <Button onClick={() => {
              onClose()
              setShowPricingModal()
            }} className='flex items-center space-x-1'>
              <SparklesSoftAccent className='size-4' />
              <div className='text-components-button-secondary-accent-text'>{t(`${i18nPrefix}.action.upgrade`)}</div>
            </Button>
          ) : (
            <Button onClick={onClose}>
              {t(`${i18nPrefix}.action.dismiss`)}
            </Button>
          )}
          <Button variant='primary' onClick={handleConfirm}>
            {t(`${i18nPrefix}.action.reVerify`)}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default React.memo(ExpireNoticeModal)
