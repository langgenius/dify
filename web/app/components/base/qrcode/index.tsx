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

const prefixEmbedded = 'appOverview.overview.appInfo.embedded.qrcode'

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
        className={`w-8 h-8 cursor-pointer hover:bg-gray-100 rounded-lg ${className ?? ''}`}
        onMouseLeave={onMouseLeave}
        onClick={onClickShow}
      >
        <div className={`w-full h-full ${QrcodeStyle.QrcodeIcon} ${isShow ? QrcodeStyle.show : ''}`} />
        {isShow && <QRCode value={content} onClick={downloadQR} bgColor="white" className="QRCode" style={{ position: 'absolute' }}/>}
      </div>
    </Tooltip>
  )
}

export default ShareQRCode
