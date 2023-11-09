import type { ChangeEvent, FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { upload } from '@/service/base'
import type { ImageFile } from '@/types/app'
import { TransferMethod } from '@/types/app'
import { useToastContext } from '@/app/components/base/toast'

type UploaderProps = {
  children: (hovering: boolean) => JSX.Element
  onUpload: (imageFile: ImageFile) => void
}
const Uploader: FC<UploaderProps> = ({
  children,
  onUpload,
}) => {
  const [hovering, setHovering] = useState(false)
  const { notify } = useToastContext()
  const { t } = useTranslation()

  const fileUpload = (imageFile: ImageFile) => {
    const formData = new FormData()
    formData.append('file', imageFile.file!)
    const onProgress = (e: ProgressEvent) => {
      if (e.lengthComputable) {
        const percent = Math.floor(e.loaded / e.total * 100)
        onUpload({ ...imageFile, progress: percent })
      }
    }

    upload({
      xhr: new XMLHttpRequest(),
      data: formData,
      onprogress: onProgress,
    })
      .then((res: { id: string }) => {
        onUpload({ ...imageFile, fileId: res.id, progress: 100 })
      })
      .catch(() => {
        notify({ type: 'error', message: t('datasetCreation.stepOne.uploader.failed') })
        onUpload({ ...imageFile, progress: -1 })
      })
      .finally()
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (!file)
      return

    const reader = new FileReader()
    reader.addEventListener(
      'load',
      () => {
        const imageFile = {
          type: TransferMethod.upload_file,
          _id: `${Date.now()}`,
          fileId: '',
          file,
          url: '',
          base64Url: reader.result as string,
          progress: 0,
        }
        onUpload(imageFile)
        fileUpload(imageFile)
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
