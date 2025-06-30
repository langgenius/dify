import type { OnlineDriveFile } from '@/models/pipeline'
import Header from './header'
import List from './list'

type FileListProps = {
  fileList: OnlineDriveFile[]
  selectedFileList: string[]
  prefix: string[]
  keywords: string
  resetKeywords: () => void
  updateKeywords: (keywords: string) => void
  searchResultsLength: number
}

const FileList = ({
  fileList,
  selectedFileList,
  prefix,
  keywords,
  resetKeywords,
  updateKeywords,
  searchResultsLength,
}: FileListProps) => {
  return (
    <div className='flex h-[400px] flex-col overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xs shadow-shadow-shadow-3'>
      <Header
        prefix={prefix}
        keywords={keywords}
        resetKeywords={resetKeywords}
        updateKeywords={updateKeywords}
        searchResultsLength={searchResultsLength}
      />
      <List
        fileList={fileList}
        selectedFileList={selectedFileList}
      />
    </div>
  )
}

export default FileList
