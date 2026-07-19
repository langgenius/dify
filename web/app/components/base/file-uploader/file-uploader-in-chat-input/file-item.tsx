import type { FileEntity } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { ProgressCircle } from '@langgenius/dify-ui/progress'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import AudioPreview from '@/app/components/base/file-uploader/audio-preview'
import PdfPreview from '@/app/components/base/file-uploader/dynamic-pdf-preview'
import VideoPreview from '@/app/components/base/file-uploader/video-preview'
import { downloadUrl } from '@/utils/download'
import { formatFileSize } from '@/utils/format'
import FileTypeIcon from '../file-type-icon'
import { fileIsUploaded, getFileAppearanceType, getFileExtension } from '../utils'

type FileItemProps = {
  file: FileEntity
  showDeleteAction?: boolean
  showDownloadAction?: boolean
  canPreview?: boolean
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
}
const FileItem = ({
  file,
  showDeleteAction,
  showDownloadAction = true,
  onRemove,
  onReUpload,
  canPreview,
}: FileItemProps) => {
  const { t } = useTranslation()
  const { id, name, type, progress, url, base64Url, isRemote } = file
  const [previewUrl, setPreviewUrl] = useState('')
  const localPreviewUrlRef = useRef<string | null>(null)
  const ext = getFileExtension(name, type, isRemote)
  const uploadError = progress === -1
  const [typeCategory = '', typeSubtype = ''] = type?.split('/') ?? []

  const previewSource = url || base64Url
  const download_url = url ? `${url}&as_attachment=true` : base64Url
  const canOpenPreview = Boolean(
    canPreview &&
    (previewSource || file.originalFile) &&
    (typeCategory === 'audio' || typeCategory === 'video' || typeSubtype === 'pdf'),
  )
  const fileNameClassName = 'mb-1 line-clamp-2 h-8 system-xs-medium break-all text-text-tertiary'

  useEffect(() => {
    return () => {
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current)
    }
  }, [])

  const openPreview = () => {
    if (previewSource) {
      setPreviewUrl(previewSource)
      return
    }
    if (!file.originalFile) return

    const localPreviewUrl = URL.createObjectURL(file.originalFile.slice())
    localPreviewUrlRef.current = localPreviewUrl
    setPreviewUrl(localPreviewUrl)
  }

  const closePreview = () => {
    setPreviewUrl('')
    if (!localPreviewUrlRef.current) return

    URL.revokeObjectURL(localPreviewUrlRef.current)
    localPreviewUrlRef.current = null
  }

  return (
    <>
      <div
        className={cn(
          'group/file-item relative h-[68px] w-[144px] rounded-lg border-[0.5px] border-components-panel-border bg-components-card-bg p-2 shadow-xs',
          !uploadError && 'hover:bg-components-card-bg-alt',
          uploadError && 'border border-state-destructive-border bg-state-destructive-hover',
          uploadError &&
            'bg-state-destructive-hover-alt hover:border-[0.5px] hover:border-state-destructive-border',
        )}
      >
        {showDeleteAction && (
          <Button
            aria-label={`${t(($) => $['operation.remove'], { ns: 'common' })} ${name}`}
            className="pointer-events-none absolute -top-1.5 -right-1.5 z-11 flex size-5 rounded-full p-0 opacity-0 outline-hidden group-hover/file-item:pointer-events-auto group-hover/file-item:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => onRemove?.(id)}
          >
            <span
              className="i-ri-close-line size-4 text-components-button-secondary-text"
              aria-hidden="true"
            />
          </Button>
        )}
        {canOpenPreview ? (
          <button
            type="button"
            className={cn(
              fileNameClassName,
              'w-full cursor-pointer rounded-sm text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
            )}
            title={name}
            aria-label={`${t(($) => $['operation.view'], { ns: 'common' })} ${name}`}
            onClick={openPreview}
          >
            {name}
          </button>
        ) : (
          <div className={fileNameClassName} title={name}>
            {name}
          </div>
        )}
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
            <ActionButton
              aria-label={`${t(($) => $['operation.download'], { ns: 'common' })} ${name}`}
              size="m"
              className="pointer-events-none absolute -top-1 -right-1 flex opacity-0 outline-hidden group-hover/file-item:pointer-events-auto group-hover/file-item:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={(e) => {
                e.stopPropagation()
                downloadUrl({ url: download_url || '', fileName: name, target: '_blank' })
              }}
            >
              <span className="i-ri-download-line size-3.5 text-text-tertiary" aria-hidden="true" />
            </ActionButton>
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
              aria-label={`${t(($) => $['operation.retry'], { ns: 'common' })} ${name}`}
              className="size-4 cursor-pointer border-none bg-transparent p-0 text-text-tertiary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              onClick={() => onReUpload?.(id)}
            >
              <span className="i-custom-vender-other-replay-line block size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {typeCategory === 'audio' && canPreview && previewUrl && (
        <AudioPreview title={name} url={previewUrl} onCancel={closePreview} />
      )}
      {typeCategory === 'video' && canPreview && previewUrl && (
        <VideoPreview title={name} url={previewUrl} onCancel={closePreview} />
      )}
      {typeSubtype === 'pdf' && canPreview && previewUrl && (
        <PdfPreview url={previewUrl} onCancel={closePreview} />
      )}
    </>
  )
}

export default FileItem
