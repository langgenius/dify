'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import {
  ArrowPathIcon,
  LinkIcon,
} from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import copy from 'copy-to-clipboard'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'

import './style.css'

type IShareLinkProps = {
  isShow: boolean
  onClose: () => void
  onGenerateCode: () => Promise<void>
  linkUrl: string
}

const prefixShare = 'appOverview.overview.appInfo.share'

const ShareLinkModal: FC<IShareLinkProps> = ({
  linkUrl,
  isShow,
  onClose,
  onGenerateCode,
}) => {
  const [genLoading, setGenLoading] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const { t } = useTranslation()
  return <Modal
    title={t(`${prefixShare}.explanation`)}
    isShow={isShow}
    onClose={onClose}
  >
    {/* share url */}
    <p className='mt-5 text-xs font-medium text-gray-500'>{t(`${prefixShare}.shareUrl`)}</p>
    {/* input share url */}
    <input disabled type='text' value={linkUrl} className='mt-1 w-full bg-gray-50 p-2 text-primary-600 text-xs font-normal outline-gray-50 hover:outline-gray-50 cursor-pointer' />
    {/* button copy link/ button regenerate */}
    <div className='mt-4 flex gap-3'>
      <Button
        type="primary"
        className='w-32 !px-0'
        onClick={() => {
          copy(linkUrl) && setIsCopied(true)
        }}
      >
        <LinkIcon className='w-4 h-4 mr-2' />
        { t(`${prefixShare}.${isCopied ? 'linkCopied' : 'copyLink'}`) }
      </Button>
      <Button className='w-32 !px-0' onClick={async () => {
        setGenLoading(true)
        await onGenerateCode()
        setGenLoading(false)
        setIsCopied(false)
      }}>
        <ArrowPathIcon className={`w-4 h-4 mr-2 ${genLoading ? 'generateLogo' : ''}`} />
        {t(`${prefixShare}.regenerate`)}
      </Button>
    </div>
  </Modal>
}

export default ShareLinkModal
