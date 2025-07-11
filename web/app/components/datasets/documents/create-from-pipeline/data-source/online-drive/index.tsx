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
import { useShallow } from 'zustand/react/shallow'

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
  const {
    prefix,
    keywords,
    bucket,
    selectedFileKeys,
    fileList,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    prefix: state.prefix,
    keywords: state.keywords,
    bucket: state.bucket,
    selectedFileKeys: state.selectedFileKeys,
    fileList: state.fileList,
  })))
  const dataSourceStore = useDataSourceStore()
  const [isLoading, setIsLoading] = useState(false)

  const datasourceNodeRunURL = !isInPipeline
    ? `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${nodeId}/run`
    : `/rag/pipelines/${pipelineId}/workflows/draft/datasource/nodes/${nodeId}/run`

  const getOnlineDriveFiles = useCallback(async (params: {
    prefix?: string[]
    bucket?: string
    startAfter?: string
    fileList?: OnlineDriveFile[]
  }) => {
    const { startAfter, prefix, bucket, fileList } = dataSourceStore.getState()
    const _prefix = params.prefix ?? prefix
    const _bucket = params.bucket ?? bucket
    const _startAfter = params.startAfter ?? startAfter.current
    const _fileList = params.fileList ?? fileList
    const prefixString = _prefix.length > 0 ? `${_prefix.join('/')}/` : ''
    setIsLoading(true)
    ssePost(
      datasourceNodeRunURL,
      {
        body: {
          inputs: {
            prefix: prefixString,
            bucket: _bucket,
            start_after: _startAfter,
            max_keys: 30, // Adjust as needed
          },
          datasource_type: DatasourceType.onlineDrive,
        },
      },
      {
        onDataSourceNodeCompleted: (documentsData: DataSourceNodeCompletedResponse) => {
          const { setFileList, isTruncated } = dataSourceStore.getState()
          const { fileList: newFileList, isTruncated: newIsTruncated } = convertOnlineDriveData(documentsData.data, _prefix, _bucket)
          setFileList([..._fileList, ...newFileList])
          isTruncated.current = newIsTruncated
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
  }, [datasourceNodeRunURL, dataSourceStore])

  useEffect(() => {
    const {
      setFileList,
      setBucket,
      setPrefix,
      setKeywords,
      setSelectedFileKeys,
      currentNodeIdRef,
    } = dataSourceStore.getState()
    if (nodeId !== currentNodeIdRef.current) {
      setFileList([])
      setBucket('')
      setPrefix([])
      setKeywords('')
      setSelectedFileKeys([])
      currentNodeIdRef.current = nodeId
      getOnlineDriveFiles({
        prefix: [],
        bucket: '',
        fileList: [],
        startAfter: '',
      })
    }
    else {
      // Avoid fetching files when come back from next step
      if (fileList.length > 0) return
      getOnlineDriveFiles({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const onlineDriveFileList = useMemo(() => {
    if (keywords)
      return fileList.filter(file => file.key.toLowerCase().includes(keywords.toLowerCase()))
    return fileList
  }, [fileList, keywords])

  const updateKeywords = useCallback((keywords: string) => {
    const { setKeywords } = dataSourceStore.getState()
    setKeywords(keywords)
  }, [dataSourceStore])

  const resetKeywords = useCallback(() => {
    const { setKeywords } = dataSourceStore.getState()

    setKeywords('')
  }, [dataSourceStore])

  const handleSelectFile = useCallback((file: OnlineDriveFile) => {
    const { selectedFileKeys, setSelectedFileKeys } = dataSourceStore.getState()
    if (file.type === OnlineDriveFileType.bucket) return
    const newSelectedFileList = produce(selectedFileKeys, (draft) => {
      if (draft.includes(file.key)) {
        const index = draft.indexOf(file.key)
        draft.splice(index, 1)
      }
      else {
        if (isInPipeline && draft.length >= 1) return
        draft.push(file.key)
      }
    })
    setSelectedFileKeys(newSelectedFileList)
  }, [dataSourceStore, isInPipeline])

  const handleOpenFolder = useCallback((file: OnlineDriveFile) => {
    const { prefix, setPrefix, setBucket, setFileList, setSelectedFileKeys } = dataSourceStore.getState()
    if (file.type === OnlineDriveFileType.file) return
    setFileList([])
    if (file.type === OnlineDriveFileType.bucket) {
      setBucket(file.displayName)
      getOnlineDriveFiles({ bucket: file.displayName, fileList: [] })
    }
    else {
      setSelectedFileKeys([])
      const displayName = file.displayName.endsWith('/') ? file.displayName.slice(0, -1) : file.displayName
      const newPrefix = produce(prefix, (draft) => {
        draft.push(displayName)
      })
      setPrefix(newPrefix)
      getOnlineDriveFiles({ prefix: newPrefix, fileList: [] })
    }
  }, [dataSourceStore, getOnlineDriveFiles])

  return (
    <div className='flex flex-col gap-y-2'>
      <Header
        docTitle='Online Drive Docs'
        docLink='https://docs.dify.ai/'
      />
      <FileList
        fileList={onlineDriveFileList}
        selectedFileKeys={selectedFileKeys}
        prefix={prefix}
        keywords={keywords}
        bucket={bucket}
        resetKeywords={resetKeywords}
        updateKeywords={updateKeywords}
        searchResultsLength={onlineDriveFileList.length}
        handleSelectFile={handleSelectFile}
        handleOpenFolder={handleOpenFolder}
        isInPipeline={isInPipeline}
        isLoading={isLoading}
        getOnlineDriveFiles={getOnlineDriveFiles}
      />
    </div>
  )
}

export default OnlineDrive
