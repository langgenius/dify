import type { OnlineDriveFile } from '@/models/pipeline'
import Item from './item'
import EmptyFolder from './empty-folder'
import EmptySearchResult from './empty-search-result'

type FileListProps = {
  fileList: OnlineDriveFile[]
  selectedFileList: string[]
  keywords: string
  handleResetKeywords: () => void
  handleSelectFile: (file: OnlineDriveFile) => void
  handleOpenFolder: (file: OnlineDriveFile) => void
}

const List = ({
  fileList,
  selectedFileList,
  keywords,
  handleResetKeywords,
  handleSelectFile,
  handleOpenFolder,
}: FileListProps) => {
  const isEmptyFolder = fileList.length === 0 && keywords.length === 0
  const isSearchResultEmpty = fileList.length === 0 && keywords.length > 0

  return (
    <div className='grow overflow-hidden p-1 pt-0'>
      {
        isEmptyFolder && (
          <EmptyFolder />
        )
      }
      {
        isSearchResultEmpty && (
          <EmptySearchResult onResetKeywords={handleResetKeywords} />
        )
      }
      {fileList.length > 0 && (
        <div className='flex h-full flex-col gap-y-px overflow-y-auto rounded-[10px] bg-background-section px-1 py-1.5'>
          {
            fileList.map((file) => {
              const isSelected = selectedFileList.includes(file.key)
              return (
                <Item
                  key={file.key}
                  file={file}
                  isSelected={isSelected}
                  onSelect={handleSelectFile}
                  onOpen={handleOpenFolder}
                />
              )
            })
          }
        </div>
      )}
    </div>
  )
}

export default List
