import type { OnlineDriveFile } from '@/models/pipeline'
import { OnlineDriveViewMode } from '@/models/pipeline'
import { useDebounceFn } from 'ahooks'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useDataSourceStoreWithSelector } from '../../store'
import Header from './header'
import List from './list'
import TreeList from './list/tree-list'

type FileListProps = {
  fileList: OnlineDriveFile[]
  selectedFileIds: string[]
  breadcrumbs: string[]
  keywords: string
  bucket: string
  isInPipeline: boolean
  resetKeywords: () => void
  updateKeywords: (keywords: string) => void
  searchResultsLength: number
  handleSelectFile: (file: OnlineDriveFile) => void
  handleOpenFolder: (file: OnlineDriveFile) => void
  isLoading: boolean
  supportBatchUpload: boolean
}

const FileList = ({
  fileList,
  selectedFileIds,
  breadcrumbs,
  keywords,
  bucket,
  resetKeywords,
  updateKeywords,
  searchResultsLength,
  handleSelectFile,
  handleOpenFolder,
  isInPipeline,
  isLoading,
  supportBatchUpload,
}: FileListProps) => {
  const [inputValue, setInputValue] = useState(keywords)

  const { viewMode, setViewMode } = useDataSourceStoreWithSelector(
    useShallow(state => ({
      viewMode: state.viewMode,
      setViewMode: state.setViewMode,
    })),
  )

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
    <div className="flex h-[400px] flex-col overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xs shadow-shadow-shadow-3">
      <Header
        breadcrumbs={breadcrumbs}
        inputValue={inputValue}
        keywords={keywords}
        bucket={bucket}
        isInPipeline={isInPipeline}
        handleInputChange={handleInputChange}
        searchResultsLength={searchResultsLength}
        handleResetKeywords={handleResetKeywords}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      {viewMode === OnlineDriveViewMode.flat
        ? (
          <List
            fileList={fileList}
            selectedFileIds={selectedFileIds}
            keywords={keywords}
            handleResetKeywords={handleResetKeywords}
            handleOpenFolder={handleOpenFolder}
            handleSelectFile={handleSelectFile}
            isLoading={isLoading}
            supportBatchUpload={supportBatchUpload}
          />
        )
        : (
          <TreeList
            fileList={fileList}
            selectedFileIds={selectedFileIds}
            keywords={keywords}
            handleResetKeywords={handleResetKeywords}
            handleOpenFolder={handleOpenFolder}
            handleSelectFile={handleSelectFile}
            isLoading={isLoading}
            supportBatchUpload={supportBatchUpload}
          />
        )}
    </div>
  )
}

export default FileList
