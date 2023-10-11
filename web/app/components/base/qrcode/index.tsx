'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { debounce } from 'lodash-es'
import QRCode from 'qrcode.react'
import Tooltip from '../tooltip'
import QrcodeStyle from './style.module.css'

type Props = {
  content: string
  selectorId: string
  className?: string
}

const prefixEmbedded = 'appOverview.overview.appInfo.qrcode.title'

const ShareQRCode = ({ content, selectorId, className }: Props) => {
  const { t } = useTranslation()
  const [isShow, setisShow] = useState<boolean>(false)
  const onClickShow = debounce(() => {
    setisShow(true)
  }, 100)

  const downloadQR = () => {
    const canvas = document.getElementsByTagName('canvas')[0]
    const link = document.createElement('a')
    link.download = 'qrcode.png'
    link.href = canvas.toDataURL()
    link.click()
  }

  const onMouseLeave = debounce(() => {
    setisShow(false)
  }, 500)

  return (
    <Tooltip
      selector={`common-qrcode-show-${selectorId}`}
      content={t(`${prefixEmbedded}`) || ''}
    >
      <div
        className={`w-8 h-8 cursor-pointer rounded-lg ${className ?? ''}`}
        onMouseLeave={onMouseLeave}
        onClick={onClickShow}
      >
        <div className={`w-full h-full ${QrcodeStyle.QrcodeIcon} ${isShow ? QrcodeStyle.show : ''}`} />
        {isShow && <div className={QrcodeStyle.qrcodeform}>
          <QRCode size={160} value={content} className={QrcodeStyle.qrcodeimage}/>
          <div className={QrcodeStyle.text}>
            <div className={`text-gray-500 ${QrcodeStyle.scan}`}>{t('appOverview.overview.appInfo.qrcode.scan')}</div>
            <div className={`text-gray-500 ${QrcodeStyle.scan}`}>·</div>
            <div className={QrcodeStyle.download} onClick={downloadQR}>{t('appOverview.overview.appInfo.qrcode.download')}</div>
          </div>
        </div>
        }
      </div>
    </Tooltip>
  )
}

export default ShareQRCode
