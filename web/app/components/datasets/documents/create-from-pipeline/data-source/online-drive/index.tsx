import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import Header from './header'
import { useCallback, useEffect } from 'react'
import FileList from './file-list'
import type { OnlineDriveFile } from '@/models/pipeline'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { ssePost } from '@/service/base'
import type { DataSourceNodeCompletedResponse, DataSourceNodeErrorResponse } from '@/types/pipeline'
import Toast from '@/app/components/base/toast'
import { useDataSourceStore } from '../store'
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
  const prefix = useDataSourceStore(state => state.prefix)
  const setPrefix = useDataSourceStore(state => state.setPrefix)
  const keywords = useDataSourceStore(state => state.keywords)
  const setKeywords = useDataSourceStore(state => state.setKeywords)
  const bucket = useDataSourceStore(state => state.bucket)
  const setBucket = useDataSourceStore(state => state.setBucket)
  const startAfter = useDataSourceStore(state => state.startAfter)
  const setStartAfter = useDataSourceStore(state => state.setStartAfter)
  const selectedFileList = useDataSourceStore(state => state.selectedFileList)
  const setSelectedFileList = useDataSourceStore(state => state.setSelectedFileList)
  const fileList = useDataSourceStore(state => state.fileList)
  const setFileList = useDataSourceStore(state => state.setFileList)

  const datasourceNodeRunURL = !isInPipeline
    ? `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${nodeId}/run`
    : `/rag/pipelines/${pipelineId}/workflows/draft/datasource/nodes/${nodeId}/run`

  const getOnlineDrive = useCallback(async () => {
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
        },
        onDataSourceNodeError: (error: DataSourceNodeErrorResponse) => {
          Toast.notify({
            type: 'error',
            message: error.error,
          })
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
        resetKeywords={resetPrefix}
        updateKeywords={updateKeywords}
        searchResultsLength={fileList.length}
        handleSelectFile={handleSelectFile}
        handleOpenFolder={handleOpenFolder}
      />
    </div>
  )
}

export default OnlineDrive
