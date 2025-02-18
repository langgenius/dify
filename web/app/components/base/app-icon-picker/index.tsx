import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Area } from 'react-easy-crop'
import Modal from '../modal'
import Divider from '../divider'
import Button from '../button'
import { ImagePlus } from '../icons/src/vender/line/images'
import { useLocalFileUploader } from '../image-uploader/hooks'
import EmojiPickerInner from '../emoji-picker/Inner'
import type { OnImageInput } from './ImageInput'
import ImageInput from './ImageInput'
import s from './style.module.css'
import getCroppedImg from './utils'
import type { AppIconType, ImageFile } from '@/types/app'
import cn from '@/utils/classnames'
import { DISABLE_UPLOAD_IMAGE_AS_ICON } from '@/config'

export type AppIconEmojiSelection = {
  type: 'emoji'
  icon: string
  background: string
}

export type AppIconImageSelection = {
  type: 'image'
  fileId: string
  url: string
}

export type AppIconSelection = AppIconEmojiSelection | AppIconImageSelection

type AppIconPickerProps = {
  onSelect?: (payload: AppIconSelection) => void
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
  const handleSelectEmoji = useCallback((emoji: string, background: string) => {
    setEmoji({ emoji, background })
  }, [setEmoji])

  const [uploading, setUploading] = useState<boolean>()

  const { handleLocalFileUpload } = useLocalFileUploader({
    limit: 3,
    disabled: false,
    onUpload: (imageFile: ImageFile) => {
      if (imageFile.fileId) {
        setUploading(false)
        onSelect?.({
          type: 'image',
          fileId: imageFile.fileId,
          url: imageFile.url,
        })
      }
    },
  })

  type InputImageInfo = { file: File } | { tempUrl: string; croppedAreaPixels: Area; fileName: string }
  const [inputImageInfo, setInputImageInfo] = useState<InputImageInfo>()

  const handleImageInput: OnImageInput = async (isCropped: boolean, fileOrTempUrl: string | File, croppedAreaPixels?: Area, fileName?: string) => {
    setInputImageInfo(
      isCropped
        ? { tempUrl: fileOrTempUrl as string, croppedAreaPixels: croppedAreaPixels!, fileName: fileName! }
        : { file: fileOrTempUrl as File },
    )
  }

  const handleSelect = async () => {
    if (activeTab === 'emoji') {
      if (emoji) {
        onSelect?.({
          type: 'emoji',
          icon: emoji.emoji,
          background: emoji.background,
        })
      }
    }
    else {
      if (!inputImageInfo)
        return
      setUploading(true)
      if ('file' in inputImageInfo) {
        handleLocalFileUpload(inputImageInfo.file)
        return
      }
      const blob = await getCroppedImg(inputImageInfo.tempUrl, inputImageInfo.croppedAreaPixels, inputImageInfo.fileName)
      const file = new File([blob], inputImageInfo.fileName, { type: blob.type })
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
    {!DISABLE_UPLOAD_IMAGE_AS_ICON && <div className="w-full p-2 pb-0">
      <div className='bg-background-body flex items-center justify-center gap-2 rounded-xl p-1'>
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`
                        flex h-8 flex-1 shrink-0 items-center justify-center rounded-xl p-2 text-sm font-medium
                        ${activeTab === tab.key && 'bg-components-main-nav-nav-button-bg-active shadow-md'}
                      `}
            onClick={() => setActiveTab(tab.key as AppIconType)}
          >
            {tab.icon} &nbsp; {tab.label}
          </button>
        ))}
      </div>
    </div>}

    <EmojiPickerInner className={cn(activeTab === 'emoji' ? 'block' : 'hidden', 'pt-2')} onSelect={handleSelectEmoji} />
    <ImageInput className={activeTab === 'image' ? 'block' : 'hidden'} onImageInput={handleImageInput} />

    <Divider className='m-0' />
    <div className='flex w-full items-center justify-center gap-2 p-3'>
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
