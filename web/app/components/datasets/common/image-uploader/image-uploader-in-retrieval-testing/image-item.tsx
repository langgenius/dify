import type { DialogHandle } from '@langgenius/dify-ui/dialog'
import type { ImagePreviewPayload } from '../../image-previewer'
import type { FileEntity } from '../types'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { ProgressCircle } from '@langgenius/dify-ui/progress'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { fileIsUploaded } from '../utils'

type ImageItemProps = {
  file: FileEntity
  showDeleteAction?: boolean
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
  disabled?: boolean
  previewHandle: DialogHandle<ImagePreviewPayload>
  previewPayload?: ImagePreviewPayload
}
export const ImageItem = memo(
  ({
    file,
    showDeleteAction,
    onRemove,
    onReUpload,
    disabled,
    previewHandle,
    previewPayload,
  }: ImageItemProps) => {
    const { t } = useTranslation(['common', 'custom'])
    const { id, progress, base64Url, sourceUrl } = file

    const handleRemove = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation()
        e.preventDefault()
        onRemove?.(id)
      },
      [onRemove, id],
    )

    const handleReUpload = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation()
        e.preventDefault()
        onReUpload?.(id)
      },
      [onReUpload, id],
    )

    return (
      <div className="group/file-image relative">
        <DialogTrigger
          handle={previewHandle}
          payload={previewPayload}
          disabled={!previewPayload}
          aria-label={file.name}
          className="block size-20 cursor-pointer border-2 border-effects-image-frame shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid disabled:cursor-default"
          onClick={(event) => event.stopPropagation()}
        >
          <img
            className="size-full object-cover"
            alt=""
            src={base64Url || sourceUrl || undefined}
          />
        </DialogTrigger>
        {showDeleteAction && (
          <IconButton
            aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
            variant="secondary"
            size="sm"
            className="absolute -top-1.5 -right-1.5 z-11 hidden rounded-full group-focus-within/file-image:flex group-hover/file-image:flex"
            disabled={disabled}
            onClick={handleRemove}
          >
            <span
              aria-hidden
              className="i-ri-close-line size-4 text-components-button-secondary-text"
            />
          </IconButton>
        )}
        {progress >= 0 && !fileIsUploaded(file) && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-effects-image-frame bg-background-overlay-alt">
            <ProgressCircle
              value={progress}
              color="white"
              aria-label={t(($) => $.uploading, { ns: 'custom' })}
            />
          </div>
        )}
        {progress === -1 && (
          <button
            type="button"
            disabled={disabled}
            aria-label={t(($) => $['operation.retry'], { ns: 'common' })}
            className="absolute inset-0 z-10 flex items-center justify-center border-2 border-state-destructive-border bg-background-overlay-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid disabled:pointer-events-none"
            onClick={handleReUpload}
          >
            <span
              aria-hidden
              className="i-custom-vender-other-replay-line size-5 text-text-primary-on-surface"
            />
          </button>
        )}
      </div>
    )
  },
)
