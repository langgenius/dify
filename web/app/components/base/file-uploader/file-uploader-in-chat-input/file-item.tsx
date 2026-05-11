import type { FileEntity } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import AudioPreview from '@/app/components/base/file-uploader/audio-preview'
import PdfPreview from '@/app/components/base/file-uploader/dynamic-pdf-preview'
import VideoPreview from '@/app/components/base/file-uploader/video-preview'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import { downloadUrl } from '@/utils/download'
import { formatFileSize } from '@/utils/format'
import FileTypeIcon from '../file-type-icon'
import {
  fileIsUploaded,
  getFileAppearanceType,
  getFileExtension,
} from '../utils'

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
  const ext = getFileExtension(name, type, isRemote)
  const uploadError = progress === -1
  const [typeCategory = '', typeSubtype = ''] = type?.split('/') ?? []

  let tmp_preview_url = url || base64Url
  if (!tmp_preview_url && file?.originalFile)
    tmp_preview_url = URL.createObjectURL(file.originalFile.slice()).toString()
  const download_url = url ? `${url}&as_attachment=true` : base64Url

  return (
    <>
      <div
        className={cn(
          'group/file-item relative h-[68px] w-[144px] rounded-lg border-[0.5px] border-components-panel-border bg-components-card-bg p-2 shadow-xs',
          !uploadError && 'hover:bg-components-card-bg-alt',
          uploadError && 'border border-state-destructive-border bg-state-destructive-hover',
          uploadError && 'bg-state-destructive-hover-alt hover:border-[0.5px] hover:border-state-destructive-border',
        )}
      >
        {
          showDeleteAction && (
            <Button
              aria-label={t('operation.remove', { ns: 'common' })}
              className="absolute -top-1.5 -right-1.5 z-11 hidden h-5 w-5 rounded-full p-0 group-hover/file-item:flex"
              onClick={() => onRemove?.(id)}
            >
              <span className="i-ri-close-line h-4 w-4 text-components-button-secondary-text" aria-hidden="true" />
            </Button>
          )
        }
        <div
          className="mb-1 line-clamp-2 h-8 cursor-pointer system-xs-medium break-all text-text-tertiary"
          title={name}
          onClick={() => canPreview && setPreviewUrl(tmp_preview_url || '')}
        >
          {name}
        </div>
        <div className="relative flex items-center justify-between">
          <div className="flex items-center system-2xs-medium-uppercase text-text-tertiary">
            <FileTypeIcon
              size="sm"
              type={getFileAppearanceType(name, type)}
              className="mr-1"
            />
            {
              ext && (
                <>
                  {ext}
                  <div className="mx-1">·</div>
                </>
              )
            }
            {
              !!file.size && formatFileSize(file.size)
            }
          </div>
          {
            showDownloadAction && download_url && (
              <ActionButton
                aria-label={t('operation.download', { ns: 'common' })}
                size="m"
                className="absolute -top-1 -right-1 hidden group-hover/file-item:flex"
                onClick={(e) => {
                  e.stopPropagation()
                  downloadUrl({ url: download_url || '', fileName: name, target: '_blank' })
                }}
              >
                <span className="i-ri-download-line h-3.5 w-3.5 text-text-tertiary" aria-hidden="true" />
              </ActionButton>
            )
          }
          {
            progress >= 0 && !fileIsUploaded(file) && (
              <ProgressCircle
                percentage={progress}
                size={12}
                className="shrink-0"
              />
            )
          }
          {
            uploadError && (
              <button
                type="button"
                aria-label={t('operation.retry', { ns: 'common' })}
                className="h-4 w-4 cursor-pointer border-none bg-transparent p-0 text-text-tertiary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={() => onReUpload?.(id)}
              >
                <span className="i-custom-vender-other-replay-line block h-4 w-4" aria-hidden="true" />
              </button>
            )
          }
        </div>
      </div>
      {
        typeCategory === 'audio' && canPreview && previewUrl && (
          <AudioPreview
            title={name}
            url={previewUrl}
            onCancel={() => setPreviewUrl('')}
          />
        )
      }
      {
        typeCategory === 'video' && canPreview && previewUrl && (
          <VideoPreview
            title={name}
            url={previewUrl}
            onCancel={() => setPreviewUrl('')}
          />
        )
      }
      {
        typeSubtype === 'pdf' && canPreview && previewUrl && (
          <PdfPreview url={previewUrl} onCancel={() => { setPreviewUrl('') }} />
        )
      }
    </>
  )
}

export default FileItem
