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
  bucket: string
  isInPipeline: boolean
  resetKeywords: () => void
  updateKeywords: (keywords: string) => void
  searchResultsLength: number
  handleSelectFile: (file: OnlineDriveFile) => void
  handleOpenFolder: (file: OnlineDriveFile) => void
  isLoading: boolean
  isTruncated: boolean
  getOnlineDriveFiles: (params: {
    prefix?: string[]
    bucket?: string
    startAfter?: string
    fileList?: OnlineDriveFile[]
  }) => void
}

const FileList = ({
  fileList,
  selectedFileList,
  prefix,
  keywords,
  bucket,
  resetKeywords,
  updateKeywords,
  searchResultsLength,
  handleSelectFile,
  handleOpenFolder,
  isInPipeline,
  isLoading,
  isTruncated,
  getOnlineDriveFiles,
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
        bucket={bucket}
        isInPipeline={isInPipeline}
        handleInputChange={handleInputChange}
        searchResultsLength={searchResultsLength}
        handleResetKeywords={handleResetKeywords}
        getOnlineDriveFiles={getOnlineDriveFiles}
      />
      <List
        fileList={fileList}
        selectedFileList={selectedFileList}
        keywords={keywords}
        handleResetKeywords={handleResetKeywords}
        handleOpenFolder={handleOpenFolder}
        handleSelectFile={handleSelectFile}
        isInPipeline={isInPipeline}
        isLoading={isLoading}
        isTruncated={isTruncated}
        getOnlineDriveFiles={getOnlineDriveFiles}
      />
    </div>
  )
}

export default FileList
