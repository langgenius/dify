import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import Header from './header'
import { useCallback, useEffect, useMemo, useState } from 'react'
import FileList from './file-list'
import type { OnlineDriveFile } from '@/models/pipeline'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { ssePost } from '@/service/base'
import type { DataSourceNodeCompletedResponse, DataSourceNodeErrorResponse } from '@/types/pipeline'
import Toast from '@/app/components/base/toast'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../store'
import { convertOnlineDriveData } from './utils'
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
  const keywords = useDataSourceStoreWithSelector(state => state.keywords)
  const bucket = useDataSourceStoreWithSelector(state => state.bucket)
  const startAfter = useDataSourceStoreWithSelector(state => state.startAfter)
  const selectedFileList = useDataSourceStoreWithSelector(state => state.selectedFileList)
  const fileList = useDataSourceStoreWithSelector(state => state.fileList)
  const isTruncated = useDataSourceStoreWithSelector(state => state.isTruncated)
  const dataSourceStore = useDataSourceStore()
  const [isLoading, setIsLoading] = useState(false)

  const datasourceNodeRunURL = !isInPipeline
    ? `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${nodeId}/run`
    : `/rag/pipelines/${pipelineId}/workflows/draft/datasource/nodes/${nodeId}/run`

  const getOnlineDrive = useCallback(async () => {
    const prefixString = prefix.length > 0 ? `${prefix.join('/')}/` : ''
    setIsLoading(true)
    ssePost(
      datasourceNodeRunURL,
      {
        body: {
          inputs: {
            prefix: prefixString,
            bucket,
            start_after: startAfter,
            max_keys: 30, // Adjust as needed
          },
          datasource_type: DatasourceType.onlineDrive,
        },
      },
      {
        onDataSourceNodeCompleted: (documentsData: DataSourceNodeCompletedResponse) => {
          const { setFileList, setIsTruncated } = dataSourceStore.getState()
          const { fileList: newFileList, isTruncated } = convertOnlineDriveData(documentsData.data, prefix)
          setFileList([...fileList, ...newFileList])
          setIsTruncated(isTruncated)
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
  }, [prefix, datasourceNodeRunURL, bucket, startAfter, dataSourceStore, fileList])

  useEffect(() => {
    getOnlineDrive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, prefix, startAfter])

  const onlineDriveFileList = useMemo(() => {
    if (keywords)
      return fileList.filter(file => file.key.toLowerCase().includes(keywords.toLowerCase()))
    return fileList
  }, [fileList, keywords])

  const updateKeywords = useCallback((keywords: string) => {
    const { setKeywords } = dataSourceStore.getState()
    setKeywords(keywords)
  }, [dataSourceStore])

  const resetPrefix = useCallback(() => {
    const { setKeywords } = dataSourceStore.getState()

    setKeywords('')
  }, [dataSourceStore])

  const handleSelectFile = useCallback((file: OnlineDriveFile) => {
    const { setSelectedFileList } = dataSourceStore.getState()
    if (file.type === OnlineDriveFileType.bucket) return
    const newSelectedFileList = produce(selectedFileList, (draft) => {
      if (draft.includes(file.key)) {
        const index = draft.indexOf(file.key)
        draft.splice(index, 1)
      }
      else {
        if (isInPipeline && draft.length >= 1) return
        draft.push(file.key)
      }
    })
    setSelectedFileList(newSelectedFileList)
  }, [dataSourceStore, isInPipeline, selectedFileList])

  const handleOpenFolder = useCallback((file: OnlineDriveFile) => {
    const { setPrefix, setBucket, setFileList, setSelectedFileList } = dataSourceStore.getState()
    if (file.type === OnlineDriveFileType.file) return
    setFileList([])
    if (file.type === OnlineDriveFileType.bucket) {
      setBucket(file.displayName)
    }
    else {
      setSelectedFileList([])
      const displayName = file.displayName.endsWith('/') ? file.displayName.slice(0, -1) : file.displayName
      const newPrefix = produce(prefix, (draft) => {
        draft.push(displayName)
      })
      setPrefix(newPrefix)
    }
  }, [dataSourceStore, prefix])

  return (
    <div className='flex flex-col gap-y-2'>
      <Header
        docTitle='Online Drive Docs'
        docLink='https://docs.dify.ai/'
      />
      <FileList
        fileList={onlineDriveFileList}
        selectedFileList={selectedFileList}
        prefix={prefix}
        keywords={keywords}
        bucket={bucket}
        resetKeywords={resetPrefix}
        updateKeywords={updateKeywords}
        searchResultsLength={onlineDriveFileList.length}
        handleSelectFile={handleSelectFile}
        handleOpenFolder={handleOpenFolder}
        isInPipeline={isInPipeline}
        isLoading={isLoading}
        isTruncated={isTruncated}
      />
    </div>
  )
}

export default OnlineDrive
