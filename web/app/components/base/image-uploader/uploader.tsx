import type { ChangeEvent, FC } from 'react'
import { useState } from 'react'
import { useLocalFileUploader } from './hooks'
import type { ImageFile } from '@/types/app'
import { ALLOW_FILE_EXTENSIONS, File_WITHOUT_IMAGE } from '@/types/app'

type UploaderProps = {
  children: (hovering: boolean) => JSX.Element
  onUpload: (imageFile: ImageFile) => void
  closePopover?: () => void
  limit?: number
  disabled?: boolean
  secure_key?: string
  document_url?: string
  document_enable?: boolean
}

const Uploader: FC<UploaderProps> = ({
  children,
  onUpload,
  closePopover,
  limit,
  disabled,
  secure_key,
  document_url,
  document_enable,
}) => {
  const [hovering, setHovering] = useState(false)
  const { handleLocalFileUpload } = useLocalFileUploader({
    limit,
    onUpload,
    disabled,
    secure_key,
    document_url,
    document_enable,
  })

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (!file)
      return
    // TODO 测试完后增加更多的类型
    if (file.name.split('.')[1] === 'docx')
      handleLocalFileUpload(file, true, secure_key, document_url, document_enable)
    else
      handleLocalFileUpload(file, false)
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
        accept={ALLOW_FILE_EXTENSIONS.filter(item => document_enable || !File_WITHOUT_IMAGE.includes(item)).map(ext => `.${ext}`).join(',')}
        onChange={secure_key => handleChange(secure_key)}
        disabled={disabled}
      />
    </div>
  )
}

export default Uploader
