'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import QrcodeStyle from './style.module.css'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  content: string
  selectorId: string
  className?: string
}

const prefixEmbedded = 'appOverview.overview.appInfo.qrcode.title'

const ShareQRCode = ({ content, selectorId, className }: Props) => {
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
      <div
        className={`w-8 h-8 cursor-pointer rounded-lg relative ${className ?? ''}`}
        onClick={toggleQRCode}
      >
        <div className={`w-full h-full ${QrcodeStyle.QrcodeIcon} ${isShow ? QrcodeStyle.show : ''}`} />
        {isShow && (
          <div
            ref={qrCodeRef}
            className={`${QrcodeStyle.qrcodeform} !absolute right-0 top-0`}
            onClick={handlePanelClick}
          >
            <QRCodeSVG size={160} value={content} className={QrcodeStyle.qrcodeimage}/>
            <div className={QrcodeStyle.text}>
              <div className={`text-text-tertiary ${QrcodeStyle.scan}`}>{t('appOverview.overview.appInfo.qrcode.scan')}</div>
              <div className={`text-text-tertiary ${QrcodeStyle.scan}`}>·</div>
              <div className={QrcodeStyle.download} onClick={downloadQR}>{t('appOverview.overview.appInfo.qrcode.download')}</div>
            </div>
          </div>
        )}
      </div>
    </Tooltip>
  )
}

export default ShareQRCode
