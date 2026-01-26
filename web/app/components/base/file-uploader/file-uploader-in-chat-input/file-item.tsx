import type { FileEntity } from '../types'
import {
  RiCloseLine,
  RiDownloadLine,
} from '@remixicon/react'
import { useState } from 'react'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import AudioPreview from '@/app/components/base/file-uploader/audio-preview'
import PdfPreview from '@/app/components/base/file-uploader/dynamic-pdf-preview'
import VideoPreview from '@/app/components/base/file-uploader/video-preview'
import { ReplayLine } from '@/app/components/base/icons/src/vender/other'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import { cn } from '@/utils/classnames'
import { formatFileSize } from '@/utils/format'
import FileTypeIcon from '../file-type-icon'
import {
  downloadFile,
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
  const { id, name, type, progress, url, base64Url, isRemote } = file
  const [previewUrl, setPreviewUrl] = useState('')
  const ext = getFileExtension(name, type, isRemote)
  const uploadError = progress === -1

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
              className="absolute -right-1.5 -top-1.5 z-[11] hidden h-5 w-5 rounded-full p-0 group-hover/file-item:flex"
              onClick={() => onRemove?.(id)}
            >
              <RiCloseLine className="h-4 w-4 text-components-button-secondary-text" />
            </Button>
          )
        }
        <div
          className="system-xs-medium mb-1 line-clamp-2 h-8 cursor-pointer break-all text-text-tertiary"
          title={name}
          onClick={() => canPreview && setPreviewUrl(tmp_preview_url || '')}
        >
          {name}
        </div>
        <div className="relative flex items-center justify-between">
          <div className="system-2xs-medium-uppercase flex items-center text-text-tertiary">
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
                size="m"
                className="absolute -right-1 -top-1 hidden group-hover/file-item:flex"
                onClick={(e) => {
                  e.stopPropagation()
                  downloadFile(download_url || '', name)
                }}
              >
                <RiDownloadLine className="h-3.5 w-3.5 text-text-tertiary" />
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
              <ReplayLine
                className="h-4 w-4 text-text-tertiary"
                onClick={() => onReUpload?.(id)}
              />
            )
          }
        </div>
      </div>
      {
        type.split('/')[0] === 'audio' && canPreview && previewUrl && (
          <AudioPreview
            title={name}
            url={previewUrl}
            onCancel={() => setPreviewUrl('')}
          />
        )
      }
      {
        type.split('/')[0] === 'video' && canPreview && previewUrl && (
          <VideoPreview
            title={name}
            url={previewUrl}
            onCancel={() => setPreviewUrl('')}
          />
        )
      }
      {
        type.split('/')[1] === 'pdf' && canPreview && previewUrl && (
          <PdfPreview url={previewUrl} onCancel={() => { setPreviewUrl('') }} />
        )
      }
    </>
  )
}

export default FileItem
