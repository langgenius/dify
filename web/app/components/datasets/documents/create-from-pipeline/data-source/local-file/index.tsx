'use client'
import FileListItem from './components/file-list-item'
import UploadDropzone from './components/upload-dropzone'
import { useLocalFileUpload } from './hooks/use-local-file-upload'

export type LocalFileProps = {
  allowedExtensions: string[]
  supportBatchUpload?: boolean
}

const LocalFile = ({
  allowedExtensions,
  supportBatchUpload = true,
}: LocalFileProps) => {
  const {
    dropRef,
    dragRef,
    fileUploaderRef,
    dragging,
    localFileList,
    fileUploadConfig,
    acceptTypes,
    supportTypesShowNames,
    hideUpload,
    selectHandle,
    fileChangeHandle,
    removeFile,
    handlePreview,
  } = useLocalFileUpload({ allowedExtensions, supportBatchUpload })

  return (
    <div className="flex flex-col">
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
          allowedExtensions={allowedExtensions}
        />
      )}
      {localFileList.length > 0 && (
        <div className="mt-1 flex flex-col gap-y-1">
          {localFileList.map((fileItem, index) => (
            <FileListItem
              key={`${fileItem.fileID}-${index}`}
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

export default LocalFile
