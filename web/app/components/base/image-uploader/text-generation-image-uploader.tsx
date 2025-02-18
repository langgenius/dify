import type { FC } from 'react'
import {
  Fragment,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from './uploader'
import ImageLinkInput from './image-link-input'
import ImageList from './image-list'
import { useImageFiles } from './hooks'
import { ImagePlus } from '@/app/components/base/icons/src/vender/line/images'
import { Link03 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { ImageFile, VisionSettings } from '@/types/app'
import { TransferMethod } from '@/types/app'

type PasteImageLinkButtonProps = {
  onUpload: (imageFile: ImageFile) => void
  disabled?: boolean
}
const PasteImageLinkButton: FC<PasteImageLinkButtonProps> = ({
  onUpload,
  disabled,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleUpload = (imageFile: ImageFile) => {
    setOpen(false)
    onUpload(imageFile)
  }

  const handleToggle = () => {
    if (disabled)
      return

    setOpen(v => !v)
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='top-start'
    >
      <PortalToFollowElemTrigger onClick={handleToggle}>
        <div className={`
          bg-components-option-card-option-bg hover:bg-components-option-card-option-bg-hover text-text-tertiary relative flex h-8 items-center justify-center rounded-lg px-3 text-xs
          ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        `}>
          <Link03 className='mr-2 h-4 w-4' />
          {t('common.imageUploader.pasteImageLink')}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='bg-components-panel-bg border-components-panel-border w-[320px] rounded-lg border-[0.5px] p-2 shadow-lg'>
          <ImageLinkInput onUpload={handleUpload} />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

type TextGenerationImageUploaderProps = {
  settings: VisionSettings
  onFilesChange: (files: ImageFile[]) => void
}
const TextGenerationImageUploader: FC<TextGenerationImageUploaderProps> = ({
  settings,
  onFilesChange,
}) => {
  const { t } = useTranslation()

  const {
    files,
    onUpload,
    onRemove,
    onImageLinkLoadError,
    onImageLinkLoadSuccess,
    onReUpload,
  } = useImageFiles()

  useEffect(() => {
    onFilesChange(files)
  }, [files])

  const localUpload = (
    <Uploader
      onUpload={onUpload}
      disabled={files.length >= settings.number_limits}
      limit={+settings.image_file_size_limit!}
    >
      {
        hovering => (
          <div className={`
            bg-components-option-card-option-bg text-text-tertiary flex h-8 cursor-pointer items-center 
            justify-center rounded-lg px-3 text-xs
            ${hovering && 'bg-components-option-card-option-bg-hover'}
          `}>
            <ImagePlus className='mr-2 h-4 w-4' />
            {t('common.imageUploader.uploadFromComputer')}
          </div>
        )
      }
    </Uploader>
  )

  const urlUpload = (
    <PasteImageLinkButton
      onUpload={onUpload}
      disabled={files.length >= settings.number_limits}
    />
  )

  return (
    <div>
      <div className='mb-1'>
        <ImageList
          list={files}
          onRemove={onRemove}
          onReUpload={onReUpload}
          onImageLinkLoadError={onImageLinkLoadError}
          onImageLinkLoadSuccess={onImageLinkLoadSuccess}
        />
      </div>
      <div className={`grid gap-1 ${settings.transfer_methods.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {
          settings.transfer_methods.map((method) => {
            if (method === TransferMethod.local_file)
              return <Fragment key={TransferMethod.local_file}>{localUpload}</Fragment>

            if (method === TransferMethod.remote_url)
              return <Fragment key={TransferMethod.remote_url}>{urlUpload}</Fragment>

            return null
          })
        }
      </div>
    </div>
  )
}

export default TextGenerationImageUploader
