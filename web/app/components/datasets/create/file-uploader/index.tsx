'use client'
import type { CustomFile as File, FileItem } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import FileListItem from './components/file-list-item'
import UploadDropzone from './components/upload-dropzone'
import { PROGRESS_ERROR } from './constants'
import { useFileUpload } from './hooks/use-file-upload'

type IFileUploaderProps = {
  fileList: FileItem[]
  titleClassName?: string
  prepareFileList: (files: FileItem[]) => void
  onFileUpdate: (fileItem: FileItem, progress: number, list: FileItem[]) => void
  onFileListUpdate?: (files: FileItem[]) => void
  onPreview: (file: File) => void
  supportBatchUpload?: boolean
}

const FileUploader = ({
  fileList,
  titleClassName,
  prepareFileList,
  onFileUpdate,
  onFileListUpdate,
  onPreview,
  supportBatchUpload = false,
}: IFileUploaderProps) => {
  const { t } = useTranslation(['common', 'datasetCreation'])

  const {
    dropRef,
    dragRef,
    fileUploaderRef,
    dragging,
    fileUploadConfig,
    acceptTypes,
    supportTypesShowNames,
    hideUpload,
    selectHandle,
    fileChangeHandle,
    removeFile,
    handlePreview,
  } = useFileUpload({
    fileList,
    prepareFileList,
    onFileUpdate,
    onFileListUpdate,
    onPreview,
    supportBatchUpload,
  })

  return (
    <div className="mb-5 w-full max-w-160">
      <h2 className={cn('mb-1 text-sm/6 font-semibold text-text-secondary', titleClassName)}>
        {t(($) => $['stepOne.uploader.title'], { ns: 'datasetCreation' })}
      </h2>

      <div role="status" aria-atomic="false" aria-relevant="additions text" className="sr-only">
        {fileList.map(({ fileID, file, progress }) => {
          // Transport progress can reach 100 before the server accepts the file.
          // Keep each announcement stable until its upload state changes.
          const message =
            progress === PROGRESS_ERROR
              ? t(($) => $['stepOne.uploader.failed'], { ns: 'datasetCreation' })
              : file.id
                ? t(($) => $['stepOne.uploader.completed'], { ns: 'datasetCreation' })
                : progress >= 0
                  ? t(($) => $.loading, { ns: 'common' })
                  : undefined
          return message ? <div key={fileID}>{`${file.name}: ${message}`}</div> : null
        })}
      </div>

      {!hideUpload && (
        <UploadDropzone
          dropRef={dropRef}
          dragRef={dragRef}
          fileUploaderRef={fileUploaderRef}
          dragging={dragging}
          supportBatchUpload={supportBatchUpload}
          supportTypesShowNames={supportTypesShowNames}
          fileUploadConfig={fileUploadConfig}
          acceptTypes={acceptTypes}
          onSelectFile={selectHandle}
          onFileChange={fileChangeHandle}
        />
      )}

      {fileList.length > 0 && (
        <div className="max-w-160 cursor-default space-y-1">
          {fileList.map((fileItem) => (
            <FileListItem
              key={fileItem.fileID}
              fileItem={fileItem}
              onPreview={handlePreview}
              onRemove={removeFile}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default FileUploader
