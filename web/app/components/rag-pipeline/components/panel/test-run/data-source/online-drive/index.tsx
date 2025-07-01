import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import Header from './header'
import { useCallback } from 'react'
import FileList from './file-list'
import type { OnlineDriveFile } from '@/models/pipeline'

type OnlineDriveProps = {
  nodeData: DataSourceNodeType
  prefix: string[]
  setPrefix: (prefix: string[]) => void
  keywords: string
  setKeywords: (keywords: string) => void
  startAfter: string
  setStartAfter: (startAfter: string) => void
  selectedFileList: string[]
  setSelectedFileList: (selectedFileList: string[]) => void
  fileList: OnlineDriveFile[]
  setFileList: (fileList: OnlineDriveFile[]) => void
}

const OnlineDrive = ({
  nodeData,
  prefix,
  setPrefix,
  keywords,
  setKeywords,
  startAfter,
  setStartAfter,
  selectedFileList,
  setSelectedFileList,
  fileList,
  setFileList,
}: OnlineDriveProps) => {
  const updateKeywords = useCallback((keywords: string) => {
    setKeywords(keywords)
  }, [setKeywords])

  const resetPrefix = useCallback(() => {
    setKeywords('')
  }, [setKeywords])

  return (
    <div className='flex flex-col gap-y-2'>
      <Header
        docTitle='Online Drive Docs'
        docLink='https://docs.dify.ai/'
      />
      <FileList
        fileList={fileList}
        selectedFileList={selectedFileList}
        prefix={prefix}
        keywords={keywords}
        resetKeywords={resetPrefix}
        updateKeywords={updateKeywords}
        searchResultsLength={fileList.length}
      />
    </div>
  )
}

export default OnlineDrive
