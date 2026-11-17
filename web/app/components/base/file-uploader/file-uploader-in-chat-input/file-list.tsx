import type { FileEntity } from '../types'
import type { FileUpload } from '@/app/components/base/features/types'
import { cn } from '@langgenius/dify-ui/cn'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { useFile } from '../hooks'
import { useStore } from '../store'
import FileImageItem from './file-image-item'
import { FileItem } from './file-item'

type FileListProps = {
  className?: string
  files: FileEntity[]
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
  showDeleteAction?: boolean
  showDownloadAction?: boolean
  canPreview?: boolean
  disabled?: boolean
}
export const FileList = ({
  className,
  files,
  onReUpload,
  onRemove,
  showDeleteAction = true,
  showDownloadAction = false,
  canPreview = true,
  disabled = false,
}: FileListProps) => {
  return (
    <div className={cn('flex flex-wrap gap-2', className)} data-testid="file-list">
      {files.map((file) => {
        if (file.supportFileType === SupportUploadFileTypes.image) {
          return (
            <FileImageItem
              key={file.id}
              file={file}
              showDeleteAction={showDeleteAction}
              showDownloadAction={showDownloadAction}
              onRemove={onRemove}
              onReUpload={onReUpload}
              canPreview={canPreview}
              disabled={disabled}
            />
          )
        }

        return (
          <FileItem
            key={file.id}
            file={file}
            showDeleteAction={showDeleteAction}
            showDownloadAction={showDownloadAction}
            onRemove={onRemove}
            onReUpload={onReUpload}
            canPreview={canPreview}
            disabled={disabled}
          />
        )
      })}
    </div>
  )
}

type FileListInChatInputProps = {
  fileConfig: FileUpload
  disabled?: boolean
}
export const FileListInChatInput = ({ fileConfig, disabled }: FileListInChatInputProps) => {
  const files = useStore((s) => s.files)
  const { handleRemoveFile, handleReUploadFile } = useFile(fileConfig)

  return (
    <FileList
      files={files}
      onReUpload={handleReUploadFile}
      onRemove={handleRemoveFile}
      disabled={disabled}
    />
  )
}
