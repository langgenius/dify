'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import {
  ArrowPathIcon,
  LinkIcon,
} from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import useCopyToClipboard from '@/hooks/use-copy-to-clipboard'

import './style.css'

type IShareLinkProps = {
  isShow: boolean
  onClose: () => void
  onGenerateCode: () => Promise<void>
  linkUrl: string
}
const ShareLinkModal: FC<IShareLinkProps> = ({
  linkUrl,
  isShow,
  onClose,
  onGenerateCode,
}) => {
  const [_, copy] = useCopyToClipboard()
  const [genLoading, setGenLoading] = useState(false)
  const { t } = useTranslation()
  return <Modal
    title={t('appOverview.overview.appInfo.share.explanation')}
    isShow={isShow}
    onClose={onClose}
  >
    {/* share url */}
    <p className='mt-5 text-xs font-medium text-gray-500'>{t('appOverview.overview.appInfo.share.shareUrl')}</p>
    {/* input share url */}
    <input disabled type='text' value={linkUrl} className='mt-1 w-full bg-gray-50 p-2 text-primary-600 text-xs font-normal outline-gray-50 hover:outline-gray-50 cursor-pointer' />
    {/* button copy link/ button regenerate */}
    <div className='mt-4 flex gap-3'>
      <Button
        type="primary"
        className='w-32'
        onClick={() => {
          copy(linkUrl)
        }}
      >
        <LinkIcon className='w-4 h-4 mr-2' />
        {t('appOverview.overview.appInfo.share.copyLink')}
      </Button>
      <Button className='w-32' onClick={async () => {
        setGenLoading(true)
        await onGenerateCode()
        setGenLoading(false)
      }}>
        <ArrowPathIcon className={`w-4 h-4 mr-2 ${genLoading ? 'generateLogo' : ''}`} />
        {t('appOverview.overview.appInfo.share.regenerate')}
      </Button>
    </div>
  </Modal>
}

export default ShareLinkModal
