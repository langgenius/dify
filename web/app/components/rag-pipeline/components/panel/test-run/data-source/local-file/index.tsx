import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import type { FileItem } from '@/models/datasets'
import FileUploader from './file-uploader'

type LocalFileProps = {
  files: FileItem[]
  updateFileList: (files: FileItem[]) => void
  updateFile: (fileItem: FileItem, progress: number, list: FileItem[]) => void
  notSupportBatchUpload: boolean
  isShowVectorSpaceFull: boolean
}

const LocalFile = ({
  files,
  updateFileList,
  updateFile,
  notSupportBatchUpload,
  isShowVectorSpaceFull,
}: LocalFileProps) => {
  return (
    <>
      <FileUploader
        fileList={files}
        prepareFileList={updateFileList}
        onFileListUpdate={updateFileList}
        onFileUpdate={updateFile}
        notSupportBatchUpload={notSupportBatchUpload}
      />
      {isShowVectorSpaceFull && (
        <VectorSpaceFull />
      )}
    </>
  )
}

export default LocalFile
