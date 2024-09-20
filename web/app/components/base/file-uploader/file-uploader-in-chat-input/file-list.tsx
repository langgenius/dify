import { useFile } from '../hooks'
import { useStore } from '../store'
import type { FileEntity } from '../types'
import FileImageItem from './file-image-item'
import FileItem from './file-item'
import type { FileUpload } from '@/app/components/base/features/types'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'

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
          if (file.supportFileType === SupportUploadFileTypes.image) {
            return (
              <FileImageItem
                key={file.id}
                file={file}
                showDeleteAction={showDeleteAction}
                onRemove={onRemove}
                onReUpload={onReUpload}
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
