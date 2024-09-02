import type { FC } from 'react'
import React, { memo, useState } from 'react'
import { RiScreenshot2Line } from '@remixicon/react'
import { useImageCapture } from '../../image-capture'
import Loading from '@/app/components/base/loading'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import Toast from '@/app/components/base/toast'

type HeaderProps = {
  title: string
  isMobile: boolean
}
const Header: FC<HeaderProps> = ({
  title,
  isMobile,
}) => {
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
    <div className={'items-center sticky justify-between top-0 flex px-8 h-16 bg-white/80 border-b-[0.5px] border-b-gray-100 backdrop-blur-md z-10'}>
      <div className={`text-base sticky text-gray-900 font-medium justify-center flex items-center ${isMobile && '!h-12'}`} >
        {title}
      </div>
      <div className='w-6 h-6 cursor-pointer hover:text-gray-500 text-gray-700'>
        { loading ? <Loading /> : <RiScreenshot2Line onClick={handleClick} /> }
      </div>
      {previewImg && <ImagePreview url={image} title={title} onCancel={() => setPreviewImg(false)} />}
    </div>
  )
}

export default memo(Header)
