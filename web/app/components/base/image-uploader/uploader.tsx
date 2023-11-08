import type { ChangeEvent, FC } from 'react'
import { useState } from 'react'
import type { FileItem } from './text-generation-image-uploader'

type UploaderProps = {
  children: (hovering: boolean) => JSX.Element
  onUpload: (file: FileItem) => void
}
const Uploader: FC<UploaderProps> = ({
  children,
  onUpload,
}) => {
  const [hovering, setHovering] = useState(false)

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (!file)
      return

    const reader = new FileReader()
    reader.addEventListener(
      'load',
      () => {
        onUpload({
          _id: `${Date.now()}`,
          origin: file,
          url: reader.result as string,
        })
      },
      false,
    )
    reader.readAsDataURL(file)
  }

  return (
    <div
      className='relative'
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {children(hovering)}
      <input
        className='absolute block top-0 right-0 bottom-0 left-0 opacity-0 cursor-pointer'
        type='file'
        accept='.png, .jpg, .jpeg, .webp, .gif'
        onChange={handleChange}
      />
    </div>
  )
}

export default Uploader
