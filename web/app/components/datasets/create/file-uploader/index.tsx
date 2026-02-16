'use client'
import type { CustomFile as File, FileItem } from '@/models/datasets'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import FileListItem from './components/file-list-item'
import UploadDropzone from './components/upload-dropzone'
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
  const { t } = useTranslation()

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
    <div className="mb-5 w-[640px]">
      <div className={cn('mb-1 text-sm font-semibold leading-6 text-text-secondary', titleClassName)}>
        {t('stepOne.uploader.title', { ns: 'datasetCreation' })}
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
        <div className="max-w-[640px] cursor-default space-y-1">
          {fileList.map(fileItem => (
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
