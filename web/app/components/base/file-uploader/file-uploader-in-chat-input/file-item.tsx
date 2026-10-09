import type { FileEntity } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { ProgressCircle } from '@langgenius/dify-ui/progress'
import { useTranslation } from 'react-i18next'
import { downloadUrl } from '@/utils/download'
import { formatFileSize } from '@/utils/format'
import { FilePreviewContent } from '../file-preview-content'
import FileTypeIcon from '../file-type-icon'
import {
  fileIsUploaded,
  getFileAppearanceType,
  getFileExtension,
  getFilePreviewKind,
} from '../utils'

type FileItemProps = {
  file: FileEntity
  showDeleteAction?: boolean
  showDownloadAction?: boolean
  canPreview?: boolean
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
}
export function FileItem({
  file,
  showDeleteAction,
  showDownloadAction = true,
  onRemove,
  onReUpload,
  canPreview,
}: FileItemProps) {
  const { t } = useTranslation(['common', 'custom'])
  const { id, name, type, progress, url, base64Url, isRemote } = file
  const ext = getFileExtension(name, type, isRemote)
  const uploadError = progress === -1
  const download_url = url ? `${url}&as_attachment=true` : base64Url
  const previewKind = canPreview ? getFilePreviewKind(file) : undefined

  return (
    <div
      className={cn(
        'group/file-item relative h-17 w-36 rounded-lg border-[0.5px] border-components-panel-border bg-components-card-bg p-2 shadow-xs',
        !uploadError && 'hover:bg-components-card-bg-alt',
        uploadError && 'border border-state-destructive-border bg-state-destructive-hover',
        uploadError &&
          'bg-state-destructive-hover-alt hover:border-[0.5px] hover:border-state-destructive-border',
      )}
    >
      {showDeleteAction && (
        <IconButton
          aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
          variant="secondary"
          size="sm"
          className="absolute -top-1.5 -right-1.5 z-11 hidden rounded-full group-hover/file-item:flex"
          onClick={() => onRemove?.(id)}
        >
          <span
            className="i-ri-close-line size-4 text-components-button-secondary-text"
            aria-hidden="true"
          />
        </IconButton>
      )}
      <div className="mb-1 h-8">
        {previewKind ? (
          <Dialog disablePointerDismissal>
            <DialogTrigger
              title={name}
              className="line-clamp-2 w-full cursor-pointer text-left system-xs-medium break-all text-text-tertiary"
            >
              {name}
            </DialogTrigger>
            <FilePreviewContent file={file} kind={previewKind} />
          </Dialog>
        ) : (
          <div className="line-clamp-2 system-xs-medium break-all text-text-tertiary" title={name}>
            {name}
          </div>
        )}
      </div>
      <div className="relative flex items-center justify-between">
        <div className="flex items-center system-2xs-medium-uppercase text-text-tertiary">
          <FileTypeIcon size="sm" type={getFileAppearanceType(name, type)} className="mr-1" />
          {ext && (
            <>
              {ext}
              <div className="mx-1">·</div>
            </>
          )}
          {!!file.size && formatFileSize(file.size)}
        </div>
        {showDownloadAction && download_url && (
          <IconButton
            aria-label={t(($) => $['operation.download'], { ns: 'common' })}
            size="md"
            className="absolute -top-1 -right-1 hidden group-hover/file-item:flex"
            onClick={(e) => {
              e.stopPropagation()
              downloadUrl({ url: download_url || '', fileName: name, target: '_blank' })
            }}
          >
            <span className="i-ri-download-line size-3.5 text-text-tertiary" aria-hidden="true" />
          </IconButton>
        )}
        {progress >= 0 && !fileIsUploaded(file) && (
          <ProgressCircle
            value={progress}
            className="shrink-0"
            aria-label={t(($) => $.uploading, { ns: 'custom' })}
          />
        )}
        {uploadError && (
          <button
            type="button"
            aria-label={t(($) => $['operation.retry'], { ns: 'common' })}
            className="size-4 cursor-pointer border-none bg-transparent p-0 text-text-tertiary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            onClick={() => onReUpload?.(id)}
          >
            <span className="i-custom-vender-other-replay-line block size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
