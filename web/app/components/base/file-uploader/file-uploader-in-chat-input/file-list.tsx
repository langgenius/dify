import { isImage } from '../utils'
import { useFile } from '../hooks'
import { useStore } from '../store'
import type { FileEntity } from '../types'
import FileImageItem from './file-image-item'
import FileItem from './file-item'
import type { FileUpload } from '@/app/components/base/features/types'

type FileListProps = {
  files: FileEntity[]
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
  showDeleteAction?: boolean
  showDownloadAction?: boolean
}
export const FileList = ({
  files,
  onReUpload,
  onRemove,
  showDeleteAction = true,
  showDownloadAction = false,
}: FileListProps) => {
  return (
    <div className='flex flex-wrap gap-2'>
      {
        files.map((file) => {
          if (isImage(file.file)) {
            return (
              <FileImageItem
                key={file.fileId}
                fileId={file.fileId}
                imageUrl={file.base64Url}
                progress={file.progress}
                showDeleteAction={showDeleteAction}
                onRemove={onRemove}
                onReUpload={onReUpload}
              />
            )
          }

          return (
            <FileItem
              key={file.fileId}
              fileId={file.fileId}
              file={file.file}
              progress={file.progress}
              showDeleteAction={showDeleteAction}
              showDownloadAction={showDownloadAction}
              onRemove={onRemove}
              onReUpload={onReUpload}
            />
          )
        })
      }
    </div>
  )
}

type FileListInChatInputProps = {
  fileConfig: FileUpload
}
export const FileListInChatInput = ({
  fileConfig,
}: FileListInChatInputProps) => {
  const files = useStore(s => s.files)
  const {
    handleRemoveFile,
    handleReUploadFile,
  } = useFile(fileConfig)

  return (
    <FileList
      files={files}
      onReUpload={handleReUploadFile}
      onRemove={handleRemoveFile}
    />
  )
}
