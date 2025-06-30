import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import Header from './header'
import { useCallback, useMemo, useState } from 'react'
import FileList from './file-list'
import { OnlineDriveFileType } from '@/models/pipeline'

type OnlineDriveProps = {
  nodeData: DataSourceNodeType
}

const OnlineDrive = ({
  nodeData,
}: OnlineDriveProps) => {
  const [prefix, setPrefix] = useState<string[]>([])
  const [keywords, setKeywords] = useState('')
  const [startAfter, setStartAfter] = useState('')
  const [selectedFileList, setSelectedFileList] = useState<string[]>([])

  const updateKeywords = useCallback((keywords: string) => {
    setKeywords(keywords)
  }, [])

  const resetPrefix = useCallback(() => {
    setKeywords('')
  }, [])

  const fileList = useMemo(() => {
    return [
      {
        key: 'Bucket_1',
        size: 1024, // unit bytes
        type: OnlineDriveFileType.bucket,
      },
    ]
  }, [])

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
