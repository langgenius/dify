import type { OnlineDriveFile } from '@/models/pipeline'
import Header from './header'
import List from './list'
import { useState } from 'react'
import { useDebounceFn } from 'ahooks'

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
  const [inputValue, setInputValue] = useState(keywords)

  const { run: updateKeywordsWithDebounce } = useDebounceFn(
    (keywords: string) => {
      updateKeywords(keywords)
    },
    { wait: 500 },
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const keywords = e.target.value
    setInputValue(keywords)
    updateKeywordsWithDebounce(keywords)
  }

  const handleResetKeywords = () => {
    setInputValue('')
    resetKeywords()
  }

  return (
    <div className='flex h-[400px] flex-col overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xs shadow-shadow-shadow-3'>
      <Header
        prefix={prefix}
        inputValue={inputValue}
        keywords={keywords}
        handleInputChange={handleInputChange}
        searchResultsLength={searchResultsLength}
        handleResetKeywords={handleResetKeywords}
      />
      <List
        fileList={fileList}
        selectedFileList={selectedFileList}
        keywords={keywords}
        handleResetKeywords={handleResetKeywords}
      />
    </div>
  )
}

export default FileList
