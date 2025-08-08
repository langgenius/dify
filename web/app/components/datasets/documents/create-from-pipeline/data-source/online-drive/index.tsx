import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import Header from '../base/header'
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
import { useModalContextSelector } from '@/context/modal-context'
import { useGetDataSourceAuth } from '@/service/use-datasource'

type OnlineDriveProps = {
  nodeId: string
  nodeData: DataSourceNodeType
  isInPipeline?: boolean
  onCredentialChange: (credentialId: string) => void
}

const OnlineDrive = ({
  nodeId,
  nodeData,
  isInPipeline = false,
  onCredentialChange,
}: OnlineDriveProps) => {
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  const {
    startAfter,
    prefix,
    keywords,
    bucket,
    selectedFileKeys,
    fileList,
    currentCredentialId,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    startAfter: state.startAfter,
    prefix: state.prefix,
    keywords: state.keywords,
    bucket: state.bucket,
    selectedFileKeys: state.selectedFileKeys,
    fileList: state.fileList,
    currentCredentialId: state.currentCredentialId,
  })))
  const dataSourceStore = useDataSourceStore()
  const [isLoading, setIsLoading] = useState(false)

  const { data: dataSourceAuth } = useGetDataSourceAuth({
    pluginId: nodeData.plugin_id,
    provider: nodeData.provider_name,
  })

  const datasourceNodeRunURL = !isInPipeline
    ? `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${nodeId}/run`
    : `/rag/pipelines/${pipelineId}/workflows/draft/datasource/nodes/${nodeId}/run`

  const getOnlineDriveFiles = useCallback(async () => {
    const { startAfter, prefix, bucket, fileList, currentCredentialId } = dataSourceStore.getState()
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
          credential_id: currentCredentialId,
        },
      },
      {
        onDataSourceNodeCompleted: (documentsData: DataSourceNodeCompletedResponse) => {
          const { setFileList, isTruncated } = dataSourceStore.getState()
          const { fileList: newFileList, isTruncated: newIsTruncated } = convertOnlineDriveData(documentsData.data, prefix, bucket)
          setFileList([...fileList, ...newFileList])
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
    getOnlineDriveFiles()
  }, [startAfter, prefix, bucket, currentCredentialId])

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
    }
    else {
      setSelectedFileKeys([])
      const displayName = file.displayName.endsWith('/') ? file.displayName.slice(0, -1) : file.displayName
      const newPrefix = produce(prefix, (draft) => {
        draft.push(displayName)
      })
      setPrefix(newPrefix)
    }
  }, [dataSourceStore, getOnlineDriveFiles])

  const handleSetting = useCallback(() => {
    setShowAccountSettingModal({
      payload: 'data-source',
    })
  }, [setShowAccountSettingModal])

  return (
    <div className='flex flex-col gap-y-2'>
      <Header
        docTitle='Online Drive Docs'
        docLink='https://docs.dify.ai/'
        onClickConfiguration={handleSetting}
        pluginName={nodeData.datasource_label}
        currentCredentialId={currentCredentialId}
        onCredentialChange={onCredentialChange}
        credentials={dataSourceAuth?.result || []}
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
      />
    </div>
  )
}

export default OnlineDrive
