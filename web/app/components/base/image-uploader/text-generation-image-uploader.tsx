import type { FC } from 'react'
import {
  Fragment,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from './uploader'
import ImageLinkInput from './image-link-input'
import ImageList from './image-list'
import { ImagePlus } from '@/app/components/base/icons/src/vender/line/images'
import { Link03 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

export type FileItem = {
  _id: string
  origin: File
  url: string
}

const PasteImageLinkButton = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

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
          <ImageLinkInput />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

type TextGenerationImageUploaderProps = {
  type: string
}
const TextGenerationImageUploader: FC<TextGenerationImageUploaderProps> = ({
  type,
}) => {
  const { t } = useTranslation()
  const [files, setFiles] = useState<FileItem[]>([])

  const handleUpload = (fileItem: FileItem) => {
    setFiles([...files, fileItem])
  }
  const handleRemove = (fileItemId: string) => {
    const index = files.findIndex(file => file._id === fileItemId)

    if (index > -1)
      setFiles([...files.slice(0, index), ...files.slice(index + 1)])
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
    <PasteImageLinkButton />
  )

  let buttons: JSX.Element[] = []
  let gridColsClassName = 'grid-cols-1'

  if (type === 'both') {
    gridColsClassName = 'grid-cols-2'
    buttons = [localUpload, urlUpload]
  }
  else if (type === 'local') {
    buttons = [localUpload]
  }
  else if (type === 'url') {
    buttons = [urlUpload]
  }

  return (
    <div>
      <div className='mb-1'>
        <ImageList
          list={files}
          onRemove={handleRemove}
        />
      </div>
      <div className={`grid gap-1 ${gridColsClassName}`}>
        {buttons.map((button, index) => <Fragment key={index}>{button}</Fragment>)}
      </div>
    </div>
  )
}

export default TextGenerationImageUploader
