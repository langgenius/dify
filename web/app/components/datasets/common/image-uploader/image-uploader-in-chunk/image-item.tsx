import type { FileEntity } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { ProgressCircle } from '@langgenius/dify-ui/progress'
import {
  RiCloseLine,
} from '@remixicon/react'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from '#i18n'
import FileImageRender from '@/app/components/base/file-uploader/file-image-render'
import { ReplayLine } from '@/app/components/base/icons/src/vender/other'
import { fileIsUploaded } from '../utils'

type ImageItemProps = {
  file: FileEntity
  showDeleteAction?: boolean
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
  onPreview?: (fileId: string) => void
}
const ImageItem = ({
  file,
  showDeleteAction,
  onRemove,
  onReUpload,
  onPreview,
}: ImageItemProps) => {
  const { t } = useTranslation()
  const { id, progress, base64Url, sourceUrl } = file

  const handlePreview = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onPreview?.(id)
  }, [onPreview, id])

  const handleRemove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onRemove?.(id)
  }, [onRemove, id])

  const handleReUpload = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onReUpload?.(id)
  }, [onReUpload, id])

  return (
    <div
      className="group/file-image relative cursor-pointer"
      onClick={handlePreview}
    >
      {
        showDeleteAction && (
          <Button
            className="absolute -top-1.5 -right-1.5 z-11 hidden size-5 rounded-full p-0 group-hover/file-image:flex"
            onClick={handleRemove}
          >
            <RiCloseLine className="size-4 text-components-button-secondary-text" />
          </Button>
        )
      }
      <FileImageRender
        className="h-[68px] w-[68px] shadow-md"
        imageUrl={base64Url || sourceUrl || ''}
      />
      {
        progress >= 0 && !fileIsUploaded(file) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center border-2 border-effects-image-frame bg-background-overlay-alt">
            <ProgressCircle
              value={progress}
              color="white"
              aria-label={t('uploading', { ns: 'custom' })}
            />
          </div>
        )
      }
      {
        progress === -1 && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center border-2 border-state-destructive-border bg-background-overlay-destructive"
            onClick={handleReUpload}
          >
            <ReplayLine className="size-5 text-text-primary-on-surface" />
          </div>
        )
      }
    </div>
  )
}

export default memo(ImageItem)
