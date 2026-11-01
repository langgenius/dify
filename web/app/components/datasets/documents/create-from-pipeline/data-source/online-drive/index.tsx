import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import type { OnlineDriveFile } from '@/models/pipeline'
import type { DataSourceNodeCompletedResponse, DataSourceNodeErrorResponse } from '@/types/pipeline'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { produce } from 'immer'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDocLink } from '@/context/i18n'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import { ssePost } from '@/service/base'
import { consoleQuery } from '@/service/console'
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
  const { t } = useTranslation(['common'])
  const [loadError, setLoadError] = useState('')
  const docLink = useDocLink()
  const isInitialMountRef = useRef(true)
  const pipelineId = useDatasetDetailContextWithSelector((s) => s.dataset?.pipeline_id)
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)
  const {
    nextPageParameters,
    breadcrumbs,
    prefix,
    keywords,
    bucket,
    selectedFileIds,
    onlineDriveFileList,
    currentCredentialId,
  } = useDataSourceStoreWithSelector(
    useShallow((state) => ({
      nextPageParameters: state.nextPageParameters,
      breadcrumbs: state.breadcrumbs,
      prefix: state.prefix,
      keywords: state.keywords,
      bucket: state.bucket,
      selectedFileIds: state.selectedFileIds,
      onlineDriveFileList: state.onlineDriveFileList,
      currentCredentialId: state.currentCredentialId,
    })),
  )
  const dataSourceStore = useDataSourceStore()
  const [isLoading, setIsLoading] = useState(false)

  const { data: dataSourceAuth } = useQuery(
    consoleQuery.auth.plugin.datasource.byProviderId.get.queryOptions({
      input: { params: { provider_id: `${nodeData.plugin_id}/${nodeData.provider_name}` } },
    }),
  )

  const requestGenerationRef = useRef(0)
  const requestControllerRef = useRef<AbortController | null>(null)
  const datasourceNodeRunURL = !isInPipeline
    ? `/rag/pipelines/${pipelineId}/workflows/published/datasource/nodes/${nodeId}/run`
    : `/rag/pipelines/${pipelineId}/workflows/draft/datasource/nodes/${nodeId}/run`

  useEffect(
    () => () => {
      requestGenerationRef.current += 1
      requestControllerRef.current?.abort()
    },
    [datasourceNodeRunURL, currentCredentialId],
  )

  const getOnlineDriveFiles = useCallback(async () => {
    const { nextPageParameters, prefix, bucket, onlineDriveFileList, currentCredentialId } =
      dataSourceStore.getState()
    const generation = ++requestGenerationRef.current
    requestControllerRef.current?.abort()
    let settled = false
    const isCurrentRequest = () =>
      !settled &&
      generation === requestGenerationRef.current &&
      currentCredentialId === dataSourceStore.getState().currentCredentialId
    setLoadError('')
    const handleError = (message: string) => {
      if (!isCurrentRequest()) return
      settled = true
      setLoadError(message || t(($) => $['api.actionFailed']))
      setIsLoading(false)
    }
    setIsLoading(true)
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
        getAbortController: (controller) => {
          if (isCurrentRequest()) requestControllerRef.current = controller
          else controller.abort()
        },
        onCompleted: (_hasError, message) => handleError(message ?? ''),
        onError: handleError,
        onDataSourceNodeCompleted: (documentsData: DataSourceNodeCompletedResponse) => {
          if (!isCurrentRequest()) return
          settled = true
          const {
            setOnlineDriveFileList,
            isTruncated,
            currentNextPageParametersRef,
            setHasBucket,
          } = dataSourceStore.getState()
          const {
            fileList: newFileList,
            isTruncated: newIsTruncated,
            nextPageParameters: newNextPageParameters,
            hasBucket: newHasBucket,
          } = convertOnlineDriveData(documentsData.data, breadcrumbs, bucket)
          setLoadError('')
          setOnlineDriveFileList([...onlineDriveFileList, ...newFileList])
          isTruncated.current = newIsTruncated
          currentNextPageParametersRef.current = newNextPageParameters
          setHasBucket(newHasBucket)
          setIsLoading(false)
        },
        onDataSourceNodeError: (error: DataSourceNodeErrorResponse) => {
          handleError(error.error)
        },
      },
    )
  }, [dataSourceStore, datasourceNodeRunURL, breadcrumbs, t])

  useEffect(() => {
    if (!currentCredentialId) return
    if (isInitialMountRef.current) {
      // Only fetch files on initial mount if fileList is empty
      if (onlineDriveFileList.length === 0) getOnlineDriveFiles()
      isInitialMountRef.current = false
    } else {
      getOnlineDriveFiles()
    }
  }, [nextPageParameters, prefix, bucket, currentCredentialId, datasourceNodeRunURL])

  const filteredOnlineDriveFileList = useMemo(() => {
    if (keywords)
      return onlineDriveFileList.filter((file) =>
        file.name.toLowerCase().includes(keywords.toLowerCase()),
      )
    return onlineDriveFileList
  }, [onlineDriveFileList, keywords])

  const updateKeywords = useCallback(
    (keywords: string) => {
      const { setKeywords } = dataSourceStore.getState()
      setKeywords(keywords)
    },
    [dataSourceStore],
  )

  const resetKeywords = useCallback(() => {
    const { setKeywords } = dataSourceStore.getState()

    setKeywords('')
  }, [dataSourceStore])

  const handleSelectFile = useCallback(
    (file: OnlineDriveFile) => {
      const { selectedFileIds, setSelectedFileIds } = dataSourceStore.getState()
      if (file.type === OnlineDriveFileType.bucket) return
      const newSelectedFileList = produce(selectedFileIds, (draft) => {
        if (draft.includes(file.id)) {
          const index = draft.indexOf(file.id)
          draft.splice(index, 1)
        } else {
          if (!supportBatchUpload && draft.length >= 1) return
          draft.push(file.id)
        }
      })
      setSelectedFileIds(newSelectedFileList)
    },
    [dataSourceStore, supportBatchUpload],
  )

  const handleOpenFolder = useCallback(
    (file: OnlineDriveFile) => {
      const {
        breadcrumbs,
        prefix,
        setBreadcrumbs,
        setPrefix,
        setBucket,
        setOnlineDriveFileList,
        setSelectedFileIds,
      } = dataSourceStore.getState()
      if (file.type === OnlineDriveFileType.file) return
      setOnlineDriveFileList([])
      if (file.type === OnlineDriveFileType.bucket) {
        setBucket(file.name)
      } else {
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
    },
    [dataSourceStore],
  )

  const handleSetting = useCallback(() => {
    setSettingsDestination('data-source')
  }, [setSettingsDestination])

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
      {loadError && (
        <div role="alert" className="p-3 system-sm-regular text-text-destructive">
          <p>{loadError}</p>
          <Button onClick={() => void getOnlineDriveFiles()}>
            {t(($) => $['operation.retry'])}
          </Button>
        </div>
      )}
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
