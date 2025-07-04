import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import Header from './header'
import { useCallback, useEffect, useState } from 'react'
import FileList from './file-list'
import type { OnlineDriveFile } from '@/models/pipeline'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { ssePost } from '@/service/base'
import type { DataSourceNodeCompletedResponse, DataSourceNodeErrorResponse } from '@/types/pipeline'
import Toast from '@/app/components/base/toast'
import { useDataSourceStoreWithSelector } from '../store'
import { convertOnlineDriveDataToFileList } from './utils'
import produce from 'immer'

type OnlineDriveProps = {
  nodeId: string
  nodeData: DataSourceNodeType
  isInPipeline?: boolean
}

const OnlineDrive = ({
  nodeId,
  nodeData,
  isInPipeline = false,
}: OnlineDriveProps) => {
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const prefix = useDataSourceStoreWithSelector(state => state.prefix)
  const setPrefix = useDataSourceStoreWithSelector(state => state.setPrefix)
  const keywords = useDataSourceStoreWithSelector(state => state.keywords)
  const setKeywords = useDataSourceStoreWithSelector(state => state.setKeywords)
  const bucket = useDataSourceStoreWithSelector(state => state.bucket)
  const setBucket = useDataSourceStoreWithSelector(state => state.setBucket)
  const startAfter = useDataSourceStoreWithSelector(state => state.startAfter)
  const setStartAfter = useDataSourceStoreWithSelector(state => state.setStartAfter)
  const selectedFileList = useDataSourceStoreWithSelector(state => state.selectedFileList)
  const setSelectedFileList = useDataSourceStoreWithSelector(state => state.setSelectedFileList)
  const fileList = useDataSourceStoreWithSelector(state => state.fileList)
  const setFileList = useDataSourceStoreWithSelector(state => state.setFileList)
  const [isLoading, setIsLoading] = useState(false)

  const datasourceNodeRunURL = !isInPipeline
    ? `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${nodeId}/run`
    : `/rag/pipelines/${pipelineId}/workflows/draft/datasource/nodes/${nodeId}/run`

  const getOnlineDrive = useCallback(async () => {
    setIsLoading(true)
    ssePost(
      datasourceNodeRunURL,
      {
        body: {
          inputs: {
            prefix: prefix.join('/'),
            bucket,
            start_after: startAfter,
            max_keys: 30, // Adjust as needed
          },
          datasource_type: DatasourceType.onlineDrive,
        },
      },
      {
        onDataSourceNodeCompleted: (documentsData: DataSourceNodeCompletedResponse) => {
          const newFileList = convertOnlineDriveDataToFileList(documentsData.data)
          setFileList([...fileList, ...newFileList])
          setIsLoading(false)
        },
        onDataSourceNodeError: (error: DataSourceNodeErrorResponse) => {
          Toast.notify({
            type: 'error',
            message: error.error,
          })
          setIsLoading(false)
        },
      },
    )
  }, [bucket, datasourceNodeRunURL, prefix, fileList, setFileList, startAfter])

  useEffect(() => {
    getOnlineDrive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, prefix, startAfter])

  const updateKeywords = useCallback((keywords: string) => {
    setKeywords(keywords)
  }, [setKeywords])

  const resetPrefix = useCallback(() => {
    setKeywords('')
  }, [setKeywords])

  const handleSelectFile = useCallback((file: OnlineDriveFile) => {
    if (file.type === OnlineDriveFileType.bucket) return
    const newSelectedFileList = produce(selectedFileList, (draft) => {
      if (draft.includes(file.key)) {
        const index = draft.indexOf(file.key)
        draft.splice(index, 1)
      }
      else {
        draft.push(file.key)
      }
    })
    setSelectedFileList(newSelectedFileList)
  }, [selectedFileList, setSelectedFileList])

  const handleOpenFolder = useCallback((file: OnlineDriveFile) => {
    if (file.type === OnlineDriveFileType.file) return
    setFileList([])
    if (file.type === OnlineDriveFileType.bucket) {
      setBucket(file.key)
    }
    else {
      const newPrefix = produce(prefix, (draft) => {
        const newList = file.key.split('/')
        draft.push(...newList)
      })
      setPrefix(newPrefix)
    }
  }, [prefix, setBucket, setFileList, setPrefix])

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
        bucket={bucket}
        resetKeywords={resetPrefix}
        updateKeywords={updateKeywords}
        searchResultsLength={fileList.length}
        handleSelectFile={handleSelectFile}
        handleOpenFolder={handleOpenFolder}
        isInPipeline={isInPipeline}
        isLoading={isLoading}
      />
    </div>
  )
}

export default OnlineDrive
