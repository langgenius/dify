import type { ChangeEvent, FC } from 'react'
import type { ImageFile } from '@/types/app'
import { useState } from 'react'
import { ALLOW_FILE_EXTENSIONS } from '@/types/app'
import { useLocalFileUploader } from './hooks'

type UploaderProps = {
  children: (hovering: boolean) => React.JSX.Element
  onUpload: (imageFile: ImageFile) => void
  closePopover?: () => void
  limit?: number
  disabled?: boolean
}

const Uploader: FC<UploaderProps> = ({
  children,
  onUpload,
  closePopover,
  limit,
  disabled,
}) => {
  const [hovering, setHovering] = useState(false)
  const { handleLocalFileUpload } = useLocalFileUploader({
    limit,
    onUpload,
    disabled,
  })

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (!file)
      return

    handleLocalFileUpload(file)
    closePopover?.()
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {children(hovering)}
      <input
        className="absolute inset-0 block w-full cursor-pointer text-[0] opacity-0 disabled:cursor-not-allowed"
        onClick={e => ((e.target as HTMLInputElement).value = '')}
        type="file"
        accept={ALLOW_FILE_EXTENSIONS.map(ext => `.${ext}`).join(',')}
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  )
}

export default Uploader
