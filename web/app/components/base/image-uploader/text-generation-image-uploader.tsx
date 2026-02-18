import type { FC } from 'react'
import type { ImageFile, VisionSettings } from '@/types/app'
import {
  Fragment,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link03 } from '@/app/components/base/icons/src/vender/line/general'
import { ImagePlus } from '@/app/components/base/icons/src/vender/line/images'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { TransferMethod } from '@/types/app'
import { useImageFiles } from './hooks'
import ImageLinkInput from './image-link-input'
import ImageList from './image-list'
import Uploader from './uploader'

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
      placement="top-start"
    >
      <PortalToFollowElemTrigger onClick={handleToggle}>
        <div className={`
          relative flex h-8 items-center justify-center rounded-lg bg-components-button-tertiary-bg px-3 text-xs text-text-tertiary hover:bg-components-button-tertiary-bg-hover
          ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        `}
        >
          <Link03 className="mr-2 h-4 w-4" />
          {t('imageUploader.pasteImageLink', { ns: 'common' })}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-10">
        <div className="w-[320px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg p-2 shadow-lg">
          <ImageLinkInput onUpload={handleUpload} />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

type TextGenerationImageUploaderProps = {
  settings: VisionSettings
  onFilesChange: (files: ImageFile[]) => void
  disabled?: boolean
}
const TextGenerationImageUploader: FC<TextGenerationImageUploaderProps> = ({
  settings,
  onFilesChange,
  disabled,
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
      disabled={files.length >= settings.number_limits || disabled}
      limit={+settings.image_file_size_limit!}
    >
      {
        hovering => (
          <div className={`
            flex h-8 cursor-pointer items-center justify-center rounded-lg
            bg-components-button-tertiary-bg px-3 text-xs text-text-tertiary
            ${hovering && 'hover:bg-components-button-tertiary-bg-hover'}
          `}
          >
            <ImagePlus className="mr-2 h-4 w-4" />
            {t('imageUploader.uploadFromComputer', { ns: 'common' })}
          </div>
        )
      }
    </Uploader>
  )

  const urlUpload = (
    <PasteImageLinkButton
      onUpload={onUpload}
      disabled={files.length >= settings.number_limits || disabled}
    />
  )

  return (
    <div>
      <div className="mb-1">
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
