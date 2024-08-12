import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Area } from 'react-easy-crop'
import Modal from '../modal'
import Divider from '../divider'
import Button from '../button'
import { ImagePlus } from '../icons/src/vender/line/images'
import EmojiPicker from '../emoji-picker'
import { useLocalFileUploader } from '../image-uploader/hooks'
import Uploader from './Uploader'
import s from './style.module.css'
import getCroppedImg from './utils'
import type { AppIconType, ImageFile } from '@/types/app'
import cn from '@/utils/classnames'

type AppIconPickerProps = {
  onSelect?: (iconType: AppIconType, icon: string, background?: string) => void
  onClose?: () => void
  className?: string
}

const AppIconPicker: FC<AppIconPickerProps> = ({
  onSelect,
  onClose,
  className,
}) => {
  const { t } = useTranslation()

  const tabs = [
    { key: 'emoji', label: t('app.iconPicker.emoji'), icon: <span className="text-lg">🤖</span> },
    { key: 'image', label: t('app.iconPicker.image'), icon: <ImagePlus /> },
  ]
  const [activeTab, setActiveTab] = useState<AppIconType>('emoji')

  const [emoji, setEmoji] = useState<{ emoji: string; background: string }>()
  const handleSelectEmoji = (emoji: string, background: string) => {
    setEmoji({ emoji, background })
  }

  const [uploading, setUploading] = useState<boolean>()

  const { handleLocalFileUpload } = useLocalFileUploader({
    limit: 3,
    disabled: false,
    onUpload: (imageFile: ImageFile) => {
      if (imageFile.fileId) {
        setUploading(false)
        onSelect?.('image', imageFile.fileId)
      }
    },
  })

  const [imageCropInfo, setImageCropInfo] = useState<{ tempUrl: string; croppedAreaPixels: Area; fileName: string }>()
  const handleImageCropped = async (tempUrl: string, croppedAreaPixels: Area, fileName: string) => {
    setImageCropInfo({ tempUrl, croppedAreaPixels, fileName })
  }

  const handleSelect = async () => {
    if (activeTab === 'emoji') {
      if (emoji)
        onSelect?.('emoji', emoji.emoji, emoji.background)
    }
    else {
      if (!imageCropInfo)
        return
      setUploading(true)
      const blob = await getCroppedImg(imageCropInfo.tempUrl, imageCropInfo.croppedAreaPixels)
      const file = new File([blob], imageCropInfo.fileName, { type: blob.type })
      handleLocalFileUpload(file)
    }
  }

  return <Modal
    onClose={() => { }}
    isShow
    closable={false}
    wrapperClassName={className}
    className={cn(s.container, '!w-[362px] !p-0')}
  >
    <div className="p-2 pb-0 w-full">
      <div className='p-1 flex items-center justify-center gap-2 bg-background-body rounded-xl'>
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`
                        p-2 flex-1 flex justify-center items-center h-8 rounded-xl text-sm shrink-0 font-medium
                        ${activeTab === tab.key && 'bg-components-main-nav-nav-button-bg-active shadow-md'}
                      `}
            onClick={() => setActiveTab(tab.key as AppIconType)}
          >
            {tab.icon} &nbsp; {tab.label}
          </button>
        ))}
      </div>
    </div>

    <Divider className='m-0' />

    <EmojiPicker className={activeTab === 'emoji' ? 'block' : 'hidden'} onSelect={handleSelectEmoji} />
    <Uploader className={activeTab === 'image' ? 'block' : 'hidden'} onImageCropped={handleImageCropped} />

    <Divider className='m-0' />
    <div className='w-full flex items-center justify-center p-3 gap-2'>
      <Button className='w-full' onClick={() => onClose?.()}>
        {t('app.iconPicker.cancel')}
      </Button>

      <Button variant="primary" className='w-full' disabled={uploading} loading={uploading} onClick={handleSelect}>
        {t('app.iconPicker.ok')}
      </Button>
    </div>
  </Modal>
}

export default AppIconPicker
