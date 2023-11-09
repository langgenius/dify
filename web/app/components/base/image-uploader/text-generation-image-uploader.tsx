import type { FC } from 'react'
import {
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from './uploader'
import ImageLinkInput from './image-link-input'
import ImageList from './image-list'
import { imageUpload } from './utils'
import { ImagePlus } from '@/app/components/base/icons/src/vender/line/images'
import { Link03 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { ImageFile, VisionSettings } from '@/types/app'
import { TransferMethod } from '@/types/app'
import { useToastContext } from '@/app/components/base/toast'

type PasteImageLinkButtonProps = {
  onUpload: (imageFile: ImageFile) => void
}
const PasteImageLinkButton: FC<PasteImageLinkButtonProps> = ({
  onUpload,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleUpload = (imageFile: ImageFile) => {
    setOpen(false)
    onUpload(imageFile)
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='top-start'
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className='relative flex items-center justify-center px-3 h-8 bg-gray-100 hover:bg-gray-200 text-xs text-gray-500 rounded-lg cursor-pointer'>
          <Link03 className='mr-2 w-4 h-4' />
          {t('common.imageUploader.pasteImageLink')}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='p-2 w-[320px] bg-white border-[0.5px] border-gray-200 rounded-lg shadow-lg'>
          <ImageLinkInput onUpload={handleUpload} />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

type TextGenerationImageUploaderProps = {
  settings: VisionSettings
}
const TextGenerationImageUploader: FC<TextGenerationImageUploaderProps> = ({
  settings,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [files, setFiles] = useState<ImageFile[]>([])

  const handleUpload = (imageFile: ImageFile) => {
    setFiles([...files, imageFile])
  }
  const handleRemove = (imageFileId: string) => {
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1)
      setFiles([...files.slice(0, index), ...files.slice(index + 1)])
  }
  const handleImageLinkLoadError = (imageFileId: string) => {
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1) {
      const currentFile = files[index]
      setFiles([...files.slice(0, index), { ...currentFile, progress: -1 }, ...files.slice(index + 1)])
    }
  }
  const handleImageLinkLoadSuccess = (imageFileId: string) => {
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1) {
      const currentImageFile = files[index]
      setFiles([...files.slice(0, index), { ...currentImageFile, progress: 100 }, ...files.slice(index + 1)])
    }
  }
  const handleReUpload = (imageFileId: string) => {
    const index = files.findIndex(file => file._id === imageFileId)

    if (index > -1) {
      const currentImageFile = files[index]
      imageUpload({
        file: currentImageFile.file!,
        onProgressCallback: (progress) => {
          setFiles([...files.slice(0, index), { ...currentImageFile, progress }, ...files.slice(index + 1)])
        },
        onSuccessCallback: (res) => {
          setFiles([...files.slice(0, index), { ...currentImageFile, fileId: res.id, progress: 100 }, ...files.slice(index + 1)])
        },
        onErrorCallback: () => {
          notify({ type: 'error', message: t('common.imageUploader.uploadFromComputerUploadError') })
          setFiles([...files.slice(0, index), { ...currentImageFile, progress: -1 }, ...files.slice(index + 1)])
        },
      })
    }
  }

  const localUpload = (
    <Uploader onUpload={handleUpload}>
      {
        hovering => (
          <div className={`
            flex items-center justify-center px-3 h-8 bg-gray-100
            text-xs text-gray-500 rounded-lg cursor-pointer
            ${hovering && 'bg-gray-200'}
          `}>
            <ImagePlus className='mr-2 w-4 h-4' />
            {t('common.imageUploader.uploadFromComputer')}
          </div>
        )
      }
    </Uploader>
  )

  const urlUpload = (
    <PasteImageLinkButton onUpload={handleUpload} />
  )

  return (
    <div>
      <div className='mb-1'>
        <ImageList
          list={files}
          onRemove={handleRemove}
          onReUpload={handleReUpload}
          onImageLinkLoadError={handleImageLinkLoadError}
          onImageLinkLoadSuccess={handleImageLinkLoadSuccess}
        />
      </div>
      <div className={`grid gap-1 ${settings.transfer_methods.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {
          settings.transfer_methods.map((method) => {
            if (method === TransferMethod.local_file)
              return localUpload

            if (method === TransferMethod.remote_url)
              return urlUpload

            return null
          })
        }
      </div>
    </div>
  )
}

export default TextGenerationImageUploader
