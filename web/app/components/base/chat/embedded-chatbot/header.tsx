import type { FC } from 'react'
import React, { useState } from 'react'
import { RiRefreshLine, RiScreenshot2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import type { Theme } from './theme/theme-context'
import { CssTransform } from './theme/utils'
import Tooltip from '@/app/components/base/tooltip'
import Loading from '@/app/components/base/loading'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import { useImageCapture } from '@/app/components/base/image-capture'
import Toast from '@/app/components/base/toast'

export type IHeaderProps = {
  isMobile: boolean
  customerIcon?: React.ReactNode
  title: string
  theme?: Theme
  onCreateNewChat?: () => void
}
const Header: FC<IHeaderProps> = ({
  isMobile,
  customerIcon,
  title,
  theme,
  onCreateNewChat,
}) => {
  const { t } = useTranslation()
  const { captureImage } = useImageCapture(title, isMobile)
  const [loading, setLoading] = useState(false)
  const [image, setImage] = useState('')
  const [previewImg, setPreviewImg] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    const image = await captureImage('dify-chat-screenshot')
    setLoading(false)
    if (image) {
      setImage(image)
      setPreviewImg(true)
    }
    else {
      Toast.notify({
        type: 'error',
        message: 'No image captured',
      })
    }
  }

  return (
    <div
      className={'shrink-0 flex items-center justify-between h-14 px-4'}
      style={Object.assign({}, CssTransform(theme?.backgroundHeaderColorStyle ?? ''), CssTransform(theme?.headerBorderBottomStyle ?? '')) }
    >
      <div className="flex items-center space-x-2">
        {customerIcon}
        <div className={'text-sm font-bold text-white'} style={CssTransform(theme?.colorFontOnHeaderStyle ?? '')}>
          {title}
        </div>
      </div>
      <div className="flex items-center min-w-[80px]">
        <Tooltip popupContent={t('share.chat.captureImage')}>
          <div className='flex cursor-pointer hover:rounded-lg hover:bg-black/5 w-10 h-8 items-center justify-center'>
            { loading ? <Loading /> : <RiScreenshot2Line className="h-6 w-6 text-sm font-bold text-white" color={theme?.colorPathOnHeader} onClick={handleClick} /> }
          </div>
        </Tooltip>
        <Tooltip popupContent={t('share.chat.resetChat')}>
          <div className='flex cursor-pointer hover:rounded-lg hover:bg-black/5 w-10 h-8 items-center justify-center' onClick={() => {
            onCreateNewChat?.()
          }}>
            <RiRefreshLine className="h-4 w-4 text-sm font-bold text-white" color={theme?.colorPathOnHeader}/>
          </div>
        </Tooltip>
        {previewImg && <ImagePreview url={image} title={title} onCancel={() => setPreviewImg(false)} />}
      </div>
    </div>
  )
}

export default React.memo(Header)
