import type { ChangeEvent, FC } from 'react'
import { useState } from 'react'
import { useLocalFileUploader } from './hooks'
import type { ImageFile } from '@/types/app'
import { ALLOW_IMAGE_EXTENSIONS, ALLOW_VIDEO_EXTENSIONS } from '@/types/app'

type UploaderProps = {
  children: (hovering: boolean) => JSX.Element
  onUpload: (imageFile: ImageFile) => void
  closePopover?: () => void
  limit?: number
  disabled?: boolean
  isSupportVideo?: boolean
}

const Uploader: FC<UploaderProps> = ({
  children,
  onUpload,
  closePopover,
  limit,
  disabled,
  isSupportVideo,
}) => {
  const [hovering, setHovering] = useState(false)
  const { handleLocalFileUpload } = useLocalFileUploader({
    limit,
    onUpload,
    disabled,
    isSupportVideo,
  })
  const allow_extensions = isSupportVideo
    ? [...ALLOW_VIDEO_EXTENSIONS, ...ALLOW_IMAGE_EXTENSIONS]
    : ALLOW_IMAGE_EXTENSIONS

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (!file)
      return

    handleLocalFileUpload(file)
    closePopover?.()
  }

  return (
    <div
      className='relative'
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {children(hovering)}
      <input
        className='absolute block inset-0 opacity-0 text-[0] w-full disabled:cursor-not-allowed cursor-pointer'
        onClick={e => ((e.target as HTMLInputElement).value = '')}
        type='file'
        accept={allow_extensions.map(ext => `.${ext}`).join(',')}
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  )
}

export default Uploader
