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

export type ExpireNoticeModalPayloadProps = {
  expireAt: number
  expired: boolean
}
export type Props = {
  onClose: () => void
  onConfirm: () => void
} & ExpireNoticeModalPayloadProps

const ExpireNoticeModal: React.FC<Props> = ({ expireAt, expired, onClose, onConfirm }) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const eduDocLink = docLink('/getting-started/dify-for-education')
  const { formatTime } = useTimestamp()
  return (
    <Modal
      isShow
      onClose={onClose}
      title={expired ? 'Your education status has expired' : `Your education status will expire on ${formatTime(expireAt, t('appLog.dateFormat') as string)}`}
      closable
      className='max-w-[600px]'
    >
      <div className='body-md-regular mt-5 space-y-5 text-text-secondary'>
        <div>
          Don't worry — this won't affect your current subscription, but you won't get the education discount when it renews unless you verify your status again.
        </div>
        <div>
          <strong className='title-md-semi-bold block'>Still in education?</strong>
          Re-verify now to get a new coupon for the upcoming academic year. It'll be saved to your account and ready to use at your next renewal.
        </div>
        <div>
          <strong className='title-md-semi-bold block'>Already graduated?</strong>
          Your current subscription will still remain active. When it ends, you'll be moved to the Sandbox plan, or you can upgrade anytime to restore full access to paid features.
        </div>
      </div>
      <div className="mt-7 flex items-center justify-between space-x-2">
        <Link className='system-xs-regular flex items-center space-x-1 text-text-accent' href={eduDocLink} target="_blank" rel="noopener noreferrer">
          <div>{t('education.learn')}</div>
          <RiExternalLinkLine className='size-3' />
        </Link>
        <div className='flex space-x-2'>
          {expired ? (
            <Button onClick={onClose} className='flex items-center space-x-1'>
              <SparklesSoftAccent className='size-4' />
              <div className='text-components-button-secondary-accent-text'>Upgrade</div>
            </Button>
          ) : (
            <Button onClick={onClose}>
            Dismiss
          </Button>
          )}
          <Button variant='primary' onClick={onConfirm}>
            Re-verify
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default React.memo(ExpireNoticeModal)
