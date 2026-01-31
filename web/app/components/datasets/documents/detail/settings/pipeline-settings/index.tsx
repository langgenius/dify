import type { NotionPage } from '@/models/common'
import type { CrawlResultItem, CustomFile, FileIndexingEstimateResponse } from '@/models/datasets'
import type { OnlineDriveFile, PublishedPipelineRunPreviewResponse } from '@/models/pipeline'
import { noop } from 'es-toolkit/function'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppUnavailable from '@/app/components/base/app-unavailable'
import Loading from '@/app/components/base/loading'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { DatasourceType } from '@/models/pipeline'
import { useInvalidDocumentDetail, useInvalidDocumentList } from '@/service/knowledge/use-document'
import { usePipelineExecutionLog, useRunPublishedPipeline } from '@/service/use-pipeline'
import ChunkPreview from '../../../create-from-pipeline/preview/chunk-preview'
import LeftHeader from './left-header'
import ProcessDocuments from './process-documents'

type PipelineSettingsProps = {
  datasetId: string
  documentId: string
}

const PipelineSettings = ({
  datasetId,
  documentId,
}: PipelineSettingsProps) => {
  const { t } = useTranslation()
  const { push } = useRouter()
  const [estimateData, setEstimateData] = useState<FileIndexingEstimateResponse | undefined>(undefined)
  const pipelineId = useDatasetDetailContextWithSelector(state => state.dataset?.pipeline_id)

  const isPreview = useRef(false)
  const formRef = useRef<any>(null)

  const { data: lastRunData, isFetching: isFetchingLastRunData, isError } = usePipelineExecutionLog({
    dataset_id: datasetId,
    document_id: documentId,
  })

  const files = useMemo(() => {
    const files: CustomFile[] = []
    if (lastRunData?.datasource_type === DatasourceType.localFile) {
      const { related_id, name, extension } = lastRunData.datasource_info
      files.push({
        id: related_id,
        name,
        extension,
      } as CustomFile)
    }
    return files
  }, [lastRunData])

  const websitePages = useMemo(() => {
    const websitePages: CrawlResultItem[] = []
    if (lastRunData?.datasource_type === DatasourceType.websiteCrawl) {
      const { content, description, source_url, title } = lastRunData.datasource_info
      websitePages.push({
        markdown: content,
        description,
        source_url,
        title,
      })
    }
    return websitePages
  }, [lastRunData])

  const onlineDocuments = useMemo(() => {
    const onlineDocuments: NotionPage[] = []
    if (lastRunData?.datasource_type === DatasourceType.onlineDocument) {
      const { workspace_id, page } = lastRunData.datasource_info
      onlineDocuments.push({
        workspace_id,
        ...page,
      })
    }
    return onlineDocuments
  }, [lastRunData])

  const onlineDriveFiles = useMemo(() => {
    const onlineDriveFiles: OnlineDriveFile[] = []
    if (lastRunData?.datasource_type === DatasourceType.onlineDrive) {
      const { id, type, name, size } = lastRunData.datasource_info
      onlineDriveFiles.push({
        id,
        name,
        type,
        size,
      })
    }
    return onlineDriveFiles
  }, [lastRunData])

  const { mutateAsync: runPublishedPipeline, isIdle, isPending } = useRunPublishedPipeline()

  const handlePreviewChunks = useCallback(async (data: Record<string, any>) => {
    if (!lastRunData)
      return
    const datasourceInfoList: Record<string, any>[] = []
    const documentInfo = lastRunData.datasource_info
    datasourceInfoList.push(documentInfo)
    await runPublishedPipeline({
      pipeline_id: pipelineId!,
      inputs: data,
      start_node_id: lastRunData.datasource_node_id,
      datasource_type: lastRunData.datasource_type,
      datasource_info_list: datasourceInfoList,
      is_preview: true,
    }, {
      onSuccess: (res) => {
        setEstimateData((res as PublishedPipelineRunPreviewResponse).data.outputs)
      },
    })
  }, [lastRunData, pipelineId, runPublishedPipeline])

  const invalidDocumentList = useInvalidDocumentList(datasetId)
  const invalidDocumentDetail = useInvalidDocumentDetail()
  const handleProcess = useCallback(async (data: Record<string, any>) => {
    if (!lastRunData)
      return
    const datasourceInfoList: Record<string, any>[] = []
    const documentInfo = lastRunData.datasource_info
    datasourceInfoList.push(documentInfo)
    await runPublishedPipeline({
      pipeline_id: pipelineId!,
      inputs: data,
      start_node_id: lastRunData.datasource_node_id,
      datasource_type: lastRunData.datasource_type,
      datasource_info_list: datasourceInfoList,
      original_document_id: documentId,
      is_preview: false,
    }, {
      onSuccess: () => {
        invalidDocumentList()
        invalidDocumentDetail()
        push(`/datasets/${datasetId}/documents`)
      },
    })
  }, [datasetId, documentId, invalidDocumentDetail, invalidDocumentList, lastRunData, pipelineId, push, runPublishedPipeline])

  const onClickProcess = useCallback(() => {
    isPreview.current = false
    formRef.current?.submit()
  }, [])

  const onClickPreview = useCallback(() => {
    isPreview.current = true
    formRef.current?.submit()
  }, [])

  const handleSubmit = useCallback((data: Record<string, any>) => {
    if (isPreview.current)
      handlePreviewChunks(data)
    else
      handleProcess(data)
  }, [handlePreviewChunks, handleProcess])

  if (isFetchingLastRunData) {
    return (
      <Loading type="app" />
    )
  }

  if (isError)
    return <AppUnavailable code={500} unknownReason={t('error.unavailable', { ns: 'datasetCreation' }) as string} />

  return (
    <div
      className="relative flex h-[calc(100vh-56px)] min-w-[1024px] overflow-x-auto rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle"
    >
      <div className="h-full min-w-0 flex-1">
        <div className="flex h-full flex-col px-14">
          <LeftHeader title={t('documentSettings.title', { ns: 'datasetPipeline' })} />
          <div className="grow overflow-y-auto">
            <ProcessDocuments
              ref={formRef}
              lastRunInputData={lastRunData!.input_data}
              datasourceNodeId={lastRunData!.datasource_node_id}
              onProcess={onClickProcess}
              onPreview={onClickPreview}
              onSubmit={handleSubmit}
              isRunning={isPending}
            />
          </div>
        </div>
      </div>
      {/* Preview */}
      <div className="h-full min-w-0 flex-1">
        <div className="flex h-full flex-col pl-2 pt-2">
          <ChunkPreview
            dataSourceType={lastRunData!.datasource_type}
            localFiles={files}
            onlineDocuments={onlineDocuments}
            websitePages={websitePages}
            onlineDriveFiles={onlineDriveFiles}
            isIdle={isIdle}
            isPending={isPending && isPreview.current}
            estimateData={estimateData}
            onPreview={onClickPreview}
            handlePreviewFileChange={noop}
            handlePreviewOnlineDocumentChange={noop}
            handlePreviewWebsitePageChange={noop}
            handlePreviewOnlineDriveFileChange={noop}
          />
        </div>
      </div>
    </div>
  )
}

export default PipelineSettings
