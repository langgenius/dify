import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { OnlineDriveFile } from '@/models/pipeline'
import type { DataSourceNodeCompletedResponse, DataSourceNodeErrorResponse } from '@/types/pipeline'
import { produce } from 'immer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import Toast from '@/app/components/base/toast'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDocLink } from '@/context/i18n'
import { useModalContextSelector } from '@/context/modal-context'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import { ssePost } from '@/service/base'
import { useGetDataSourceAuth } from '@/service/use-datasource'
import Header from '../base/header'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../store'
import FileList from './file-list'
import { convertOnlineDriveData } from './utils'

type OnlineDriveProps = {
  nodeId: string
  nodeData: DataSourceNodeType
  onCredentialChange: (credentialId: string) => void
  isInPipeline?: boolean
  supportBatchUpload?: boolean
}

const OnlineDrive = ({
  nodeId,
  nodeData,
  isInPipeline = false,
  supportBatchUpload = true,
  onCredentialChange,
}: OnlineDriveProps) => {
  const docLink = useDocLink()
  const [isInitialMount, setIsInitialMount] = useState(true)
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  const {
    nextPageParameters,
    breadcrumbs,
    prefix,
    keywords,
    bucket,
    selectedFileIds,
    onlineDriveFileList,
    currentCredentialId,
  } = useDataSourceStoreWithSelector(useShallow(state => ({
    nextPageParameters: state.nextPageParameters,
    breadcrumbs: state.breadcrumbs,
    prefix: state.prefix,
    keywords: state.keywords,
    bucket: state.bucket,
    selectedFileIds: state.selectedFileIds,
    onlineDriveFileList: state.onlineDriveFileList,
    currentCredentialId: state.currentCredentialId,
  })))
  const dataSourceStore = useDataSourceStore()
  const [isLoading, setIsLoading] = useState(false)
  const isLoadingRef = useRef(false)

  const { data: dataSourceAuth } = useGetDataSourceAuth({
    pluginId: nodeData.plugin_id,
    provider: nodeData.provider_name,
  })

  const datasourceNodeRunURL = !isInPipeline
    ? `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${nodeId}/run`
    : `/rag/pipelines/${pipelineId}/workflows/draft/datasource/nodes/${nodeId}/run`

  const getOnlineDriveFiles = useCallback(async () => {
    if (isLoadingRef.current)
      return
    const { nextPageParameters, prefix, bucket, onlineDriveFileList, currentCredentialId } = dataSourceStore.getState()
    setIsLoading(true)
    isLoadingRef.current = true
    ssePost(
      datasourceNodeRunURL,
      {
        body: {
          inputs: {
            prefix: prefix[prefix.length - 1],
            bucket,
            next_page_parameters: nextPageParameters,
            max_keys: 30,
          },
          datasource_type: DatasourceType.onlineDrive,
          credential_id: currentCredentialId,
        },
      },
      {
        onDataSourceNodeCompleted: (documentsData: DataSourceNodeCompletedResponse) => {
          const { setOnlineDriveFileList, isTruncated, currentNextPageParametersRef, setHasBucket } = dataSourceStore.getState()
          const {
            fileList: newFileList,
            isTruncated: newIsTruncated,
            nextPageParameters: newNextPageParameters,
            hasBucket: newHasBucket,
          } = convertOnlineDriveData(documentsData.data, breadcrumbs, bucket)
          setOnlineDriveFileList([...onlineDriveFileList, ...newFileList])
          isTruncated.current = newIsTruncated
          currentNextPageParametersRef.current = newNextPageParameters
          setHasBucket(newHasBucket)
          setIsLoading(false)
          isLoadingRef.current = false
        },
        onDataSourceNodeError: (error: DataSourceNodeErrorResponse) => {
          Toast.notify({
            type: 'error',
            message: error.error,
          })
          setIsLoading(false)
          isLoadingRef.current = false
        },
      },
    )
  }, [dataSourceStore, datasourceNodeRunURL, breadcrumbs])

  useEffect(() => {
    if (!currentCredentialId)
      return
    if (isInitialMount) {
      // Only fetch files on initial mount if fileList is empty
      if (onlineDriveFileList.length === 0)
        getOnlineDriveFiles()
      setIsInitialMount(false)
    }
    else {
      getOnlineDriveFiles()
    }
  }, [nextPageParameters, prefix, bucket, currentCredentialId])

  const filteredOnlineDriveFileList = useMemo(() => {
    if (keywords)
      return onlineDriveFileList.filter(file => file.name.toLowerCase().includes(keywords.toLowerCase()))
    return onlineDriveFileList
  }, [onlineDriveFileList, keywords])

  const updateKeywords = useCallback((keywords: string) => {
    const { setKeywords } = dataSourceStore.getState()
    setKeywords(keywords)
  }, [dataSourceStore])

  const resetKeywords = useCallback(() => {
    const { setKeywords } = dataSourceStore.getState()

    setKeywords('')
  }, [dataSourceStore])

  const handleSelectFile = useCallback((file: OnlineDriveFile) => {
    const { selectedFileIds, setSelectedFileIds } = dataSourceStore.getState()
    if (file.type === OnlineDriveFileType.bucket)
      return
    const newSelectedFileList = produce(selectedFileIds, (draft) => {
      if (draft.includes(file.id)) {
        const index = draft.indexOf(file.id)
        draft.splice(index, 1)
      }
      else {
        if (!supportBatchUpload && draft.length >= 1)
          return
        draft.push(file.id)
      }
    })
    setSelectedFileIds(newSelectedFileList)
  }, [dataSourceStore, supportBatchUpload])

  const handleOpenFolder = useCallback((file: OnlineDriveFile) => {
    const { breadcrumbs, prefix, setBreadcrumbs, setPrefix, setBucket, setOnlineDriveFileList, setSelectedFileIds } = dataSourceStore.getState()
    if (file.type === OnlineDriveFileType.file)
      return
    setOnlineDriveFileList([])
    if (file.type === OnlineDriveFileType.bucket) {
      setBucket(file.name)
    }
    else {
      setSelectedFileIds([])
      const newBreadcrumbs = produce(breadcrumbs, (draft) => {
        draft.push(file.name)
      })
      const newPrefix = produce(prefix, (draft) => {
        draft.push(file.id)
      })
      setBreadcrumbs(newBreadcrumbs)
      setPrefix(newPrefix)
    }
  }, [dataSourceStore])

  const handleSetting = useCallback(() => {
    setShowAccountSettingModal({
      payload: ACCOUNT_SETTING_TAB.DATA_SOURCE,
    })
  }, [setShowAccountSettingModal])

  return (
    <div className="flex flex-col gap-y-2">
      <Header
        docTitle="Docs"
        docLink={docLink('/use-dify/knowledge/knowledge-pipeline/authorize-data-source')}
        onClickConfiguration={handleSetting}
        pluginName={nodeData.datasource_label}
        currentCredentialId={currentCredentialId}
        onCredentialChange={onCredentialChange}
        credentials={dataSourceAuth?.result || []}
      />
      <FileList
        fileList={filteredOnlineDriveFileList}
        selectedFileIds={selectedFileIds}
        breadcrumbs={breadcrumbs}
        keywords={keywords}
        bucket={bucket}
        resetKeywords={resetKeywords}
        updateKeywords={updateKeywords}
        searchResultsLength={filteredOnlineDriveFileList.length}
        handleSelectFile={handleSelectFile}
        handleOpenFolder={handleOpenFolder}
        isInPipeline={isInPipeline}
        isLoading={isLoading}
        supportBatchUpload={supportBatchUpload}
      />
    </div>
  )
}

export default OnlineDrive
