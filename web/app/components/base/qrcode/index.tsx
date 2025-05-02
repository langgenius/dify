'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiQrCodeLine,
} from '@remixicon/react'
import { QRCodeCanvas as QRCode } from 'qrcode.react'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  content: string
}

const prefixEmbedded = 'appOverview.overview.appInfo.qrcode.title'

const ShareQRCode = ({ content }: Props) => {
  const { t } = useTranslation()
  const [isShow, setIsShow] = useState<boolean>(false)
  const qrCodeRef = useRef<HTMLDivElement>(null)

  const toggleQRCode = (event: React.MouseEvent) => {
    event.stopPropagation()
    setIsShow(prev => !prev)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (qrCodeRef.current && !qrCodeRef.current.contains(event.target as Node))
        setIsShow(false)
    }

    if (isShow)
      document.addEventListener('click', handleClickOutside)

    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [isShow])

  const downloadQR = () => {
    const canvas = document.getElementsByTagName('canvas')[0]
    const link = document.createElement('a')
    link.download = 'qrcode.png'
    link.href = canvas.toDataURL()
    link.click()
  }

  const handlePanelClick = (event: React.MouseEvent) => {
    event.stopPropagation()
  }

  return (
    <Tooltip
      popupContent={t(`${prefixEmbedded}`) || ''}
    >
      <div className='relative w-6 h-6' onClick={toggleQRCode}>
        <ActionButton>
          <RiQrCodeLine className='w-4 h-4' />
        </ActionButton>
        {isShow && (
          <div
            ref={qrCodeRef}
            className='absolute top-8 -right-8 z-10 w-[232px] flex flex-col items-center bg-components-panel-bg shadow-xs rounded-lg p-4'
            onClick={handlePanelClick}
          >
            <QRCode size={160} value={content} className='mb-2' />
            <div className='flex items-center system-xs-regular'>
              <div className='text-text-tertiary'>{t('appOverview.overview.appInfo.qrcode.scan')}</div>
              <div className='text-text-tertiary'>·</div>
              <div className='text-text-accent-secondary cursor-pointer' onClick={downloadQR}>{t('appOverview.overview.appInfo.qrcode.download')}</div>
            </div>
          </div>
        )}
      </div>
    </Tooltip>
  )
}

export default ShareQRCode
