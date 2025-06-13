import { useCallback, useRef, useState } from 'react'
import type { CrawlResultItem, DocumentItem, FileIndexingEstimateResponse } from '@/models/datasets'
import type { NotionPage } from '@/models/common'
import { useTranslation } from 'react-i18next'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDocumentDetail } from '@/service/knowledge/use-document'
import AppUnavailable from '@/app/components/base/app-unavailable'
import ChunkPreview from '../../../create-from-pipeline/preview/chunk-preview'
import Loading from '@/app/components/base/loading'
import type { DatasourceType } from '@/models/pipeline'
import ProcessDocuments from './process-documents'
import LeftHeader from './left-header'

type PipelineSettingsProps = {
  datasetId: string
  documentId: string
}

const PipelineSettings = ({
  datasetId,
  documentId,
}: PipelineSettingsProps) => {
  const { t } = useTranslation()
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)
  const [estimateData, setEstimateData] = useState<FileIndexingEstimateResponse | undefined>(undefined)

  const isPreview = useRef(false)
  const formRef = useRef<any>(null)

  const { data: documentDetail, error, isFetching: isFetchingDocumentDetail } = useDocumentDetail({
    datasetId,
    documentId,
    params: { metadata: 'without' },
  })

  const handlePreviewChunks = useCallback(async (data: Record<string, any>) => {
    // todo: Preview
  }, [])

  const handleProcess = useCallback(async (data: Record<string, any>) => {
    // todo: Process
  }, [])

  const onClickProcess = useCallback(() => {
    isPreview.current = false
    formRef.current?.submit()
  }, [])

  const onClickPreview = useCallback(() => {
    isPreview.current = true
    formRef.current?.submit()
  }, [])

  const handleSubmit = useCallback((data: Record<string, any>) => {
    isPreview.current ? handlePreviewChunks(data) : handleProcess(data)
  }, [handlePreviewChunks, handleProcess])

  const handlePreviewFileChange = useCallback((file: DocumentItem) => {
    onClickPreview()
  }, [onClickPreview])

  const handlePreviewOnlineDocumentChange = useCallback((page: NotionPage) => {
    onClickPreview()
  }, [onClickPreview])

  const handlePreviewWebsiteChange = useCallback((website: CrawlResultItem) => {
    onClickPreview()
  }, [onClickPreview])

  if (isFetchingDocumentDetail) {
    return (
      <Loading type='app' />
    )
  }

  if (error)
    return <AppUnavailable code={500} unknownReason={t('datasetCreation.error.unavailable') as string} />

  return (
    <div
      className='relative flex h-[calc(100vh-56px)] min-w-[1024px] overflow-x-auto rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle'
    >
      <div className='flex h-full flex-1 flex-col px-14'>
        <LeftHeader title={t('datasetPipeline.documentSettings.title')} />
        <div className='grow overflow-y-auto'>
          <ProcessDocuments
            ref={formRef}
            documentId={documentId}
            onProcess={onClickProcess}
            onPreview={onClickPreview}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
      {/* Preview */}
      <div className='flex h-full flex-1 shrink-0 pl-2 pt-2'>
        <ChunkPreview
          dataSourceType={documentDetail!.data_source_type as DatasourceType}
          // @ts-expect-error mock data // todo: remove mock data
          files={[{
            id: '12345678',
            name: 'test-file',
            extension: 'txt',
          }]}
          onlineDocuments={[]}
          websitePages={[]}
          isIdle={true}
          isPending={true}
          estimateData={estimateData}
          onPreview={onClickPreview}
          handlePreviewFileChange={handlePreviewFileChange}
          handlePreviewOnlineDocumentChange={handlePreviewOnlineDocumentChange}
          handlePreviewWebsitePageChange={handlePreviewWebsiteChange}
        />
      </div>
    </div>
  )
}

export default PipelineSettings
