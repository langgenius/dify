import type { FC } from 'react'
import type { ImageFile } from '@/types/app'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { TransferMethod } from '@/types/app'

type ImageLinkInputProps = {
  onUpload: (imageFile: ImageFile) => void
  disabled?: boolean
}
const regex = /^(https?|ftp):\/\//
const ImageLinkInput: FC<ImageLinkInputProps> = ({
  onUpload,
  disabled,
}) => {
  const { t } = useTranslation()
  const [imageLink, setImageLink] = useState('')

  const handleClick = () => {
    if (disabled)
      return

    const imageFile = {
      type: TransferMethod.remote_url,
      _id: `${Date.now()}`,
      fileId: '',
      progress: regex.test(imageLink) ? 0 : -1,
      url: imageLink,
    }

    onUpload(imageFile)
  }

  return (
    <div className="flex h-8 items-center rounded-lg border border-components-panel-border bg-components-panel-bg pl-1.5 pr-1 shadow-xs">
      <input
        type="text"
        className="mr-0.5 h-[18px] grow appearance-none bg-transparent px-1 text-[13px] text-text-primary outline-none"
        value={imageLink}
        onChange={e => setImageLink(e.target.value)}
        placeholder={t('imageUploader.pasteImageLinkInputPlaceholder', { ns: 'common' }) || ''}
      />
      <Button
        variant="primary"
        size="small"
        disabled={!imageLink || disabled}
        onClick={handleClick}
      >
        {t('operation.ok', { ns: 'common' })}
      </Button>
    </div>
  )
}

export default ImageLinkInput
