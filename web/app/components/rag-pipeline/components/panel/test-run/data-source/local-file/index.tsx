import type { FileItem } from '@/models/datasets'
import FileUploader from './file-uploader'

type LocalFileProps = {
  files: FileItem[]
  updateFileList: (files: FileItem[]) => void
  updateFile: (fileItem: FileItem, progress: number, list: FileItem[]) => void
  notSupportBatchUpload: boolean
}

const LocalFile = ({
  files,
  updateFileList,
  updateFile,
  notSupportBatchUpload,
}: LocalFileProps) => {
  return (
    <FileUploader
      fileList={files}
      prepareFileList={updateFileList}
      onFileListUpdate={updateFileList}
      onFileUpdate={updateFile}
      notSupportBatchUpload={notSupportBatchUpload}
    />
  )
}

export default LocalFile
