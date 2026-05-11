'use client'
import type { FC } from 'react'
import type { DataSourceInfo, DocumentDisplayStatus, FileItem, FullDocumentDetail, LegacyDataSourceInfo } from '@/models/datasets'
import type { SegmentImportStatus } from '@/types/dataset'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import FloatRightContainer from '@/app/components/base/float-right-container'
import Loading from '@/app/components/base/loading'
import Metadata from '@/app/components/datasets/metadata/metadata-document'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { ChunkingMode, DisplayStatusList } from '@/models/datasets'
import { useRouter, useSearchParams } from '@/next/navigation'
import { useDocumentDetail, useDocumentMetadata, useInvalidDocumentList } from '@/service/knowledge/use-document'
import { useCheckSegmentBatchImportProgress, useChildSegmentListKey, useSegmentBatchImport, useSegmentListKey } from '@/service/knowledge/use-segment'
import { useInvalid } from '@/service/use-base'
import { segmentImportStatus } from '@/types/dataset'
import Operations from '../components/operations'
import StatusItem from '../status-item'
import BatchModal from './batch-modal'
import Completed from './completed'
import { DocumentContext } from './context'
import { DocumentTitle } from './document-title'
import Embedding from './embedding'
import { SegmentAdd } from './segment-add'
import style from './style.module.css'

type DocumentDetailProps = {
  datasetId: string
  documentId: string
}

const NON_TERMINAL_DISPLAY_STATUSES = new Set<typeof DisplayStatusList[number]>(
  DisplayStatusList.filter(s => s === 'queuing' || s === 'indexing' || s === 'paused'),
)

const isLegacyDataSourceInfo = (info?: DataSourceInfo): info is LegacyDataSourceInfo => {
  return !!info && 'upload_file' in info
}

const DocumentDetail: FC<DocumentDetailProps> = ({ datasetId, documentId }) => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t } = useTranslation()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const dataset = useDatasetDetailContextWithSelector(s => s.dataset)
  const embeddingAvailable = !!dataset?.embedding_available
  const [showMetadata, setShowMetadata] = useState(!isMobile)
  const [newSegmentModalVisible, setNewSegmentModalVisible] = useState(false)
  const [batchModalVisible, setBatchModalVisible] = useState(false)
  const [importStatus, setImportStatus] = useState<SegmentImportStatus>()
  const showNewSegmentModal = () => setNewSegmentModalVisible(true)
  const showBatchModal = () => setBatchModalVisible(true)
  const hideBatchModal = () => setBatchModalVisible(false)
  const resetImportStatus = () => setImportStatus(undefined)

  const { mutateAsync: checkSegmentBatchImportProgress } = useCheckSegmentBatchImportProgress()
  const checkProcess = async (jobID: string) => {
    await checkSegmentBatchImportProgress({ jobID }, {
      onSuccess: (res) => {
        setImportStatus(res.job_status)
        if (res.job_status === segmentImportStatus.waiting || res.job_status === segmentImportStatus.processing)
          setTimeout(() => checkProcess(res.job_id), 2500)
        if (res.job_status === segmentImportStatus.error)
          toast.error(`${t('list.batchModal.runError', { ns: 'datasetDocuments' })}`)
      },
      onError: (e) => {
        const message = 'message' in e ? `: ${e.message}` : ''
        toast.error(`${t('list.batchModal.runError', { ns: 'datasetDocuments' })}${message}`)
      },
    })
  }

  const { mutateAsync: segmentBatchImport } = useSegmentBatchImport()
  const runBatch = async (csv: FileItem) => {
    await segmentBatchImport({
      url: `/datasets/${datasetId}/documents/${documentId}/segments/batch_import`,
      body: { upload_file_id: csv.file.id! },
    }, {
      onSuccess: (res) => {
        setImportStatus(res.job_status)
        checkProcess(res.job_id)
      },
      onError: (e) => {
        const message = 'message' in e ? `: ${e.message}` : ''
        toast.error(`${t('list.batchModal.runError', { ns: 'datasetDocuments' })}${message}`)
      },
    })
  }

  const { data: documentDetail, error, refetch: detailMutate } = useDocumentDetail({
    datasetId,
    documentId,
    params: { metadata: 'without' },
    refetchInterval: (query) => {
      const status = query.state.data?.display_status
      if (!status || NON_TERMINAL_DISPLAY_STATUSES.has(status))
        return 2500
      return false
    },
  })

  const { data: documentMetadata } = useDocumentMetadata({
    datasetId,
    documentId,
    params: { metadata: 'only' },
  })

  const backToPrev = useCallback(() => {
    const queryString = searchParams.toString()
    const backPath = `/datasets/${datasetId}/documents${queryString ? `?${queryString}` : ''}`
    router.push(backPath)
  }, [searchParams, datasetId, router])

  const isDetailLoading = !documentDetail && !error

  const embedding = NON_TERMINAL_DISPLAY_STATUSES.has(documentDetail?.display_status as DocumentDisplayStatus)

  const documentUploadFile = useMemo(() => {
    if (!documentDetail?.data_source_info)
      return undefined
    if (isLegacyDataSourceInfo(documentDetail.data_source_info))
      return documentDetail.data_source_info.upload_file
    return undefined
  }, [documentDetail?.data_source_info])

  const invalidChunkList = useInvalid(useSegmentListKey)
  const invalidChildChunkList = useInvalid(useChildSegmentListKey)
  const invalidDocumentList = useInvalidDocumentList(datasetId)

  const handleOperate = useCallback((operateName?: string) => {
    invalidDocumentList()
    if (operateName === 'delete') {
      backToPrev()
    }
    else {
      detailMutate()
      // If operation is not rename, refresh the chunk list after 5 seconds
      if (operateName) {
        setTimeout(() => {
          invalidChunkList()
          invalidChildChunkList()
        }, 5000)
      }
    }
  }, [invalidDocumentList, backToPrev, detailMutate, invalidChunkList, invalidChildChunkList])

  const parentMode = useMemo(() => {
    return documentDetail?.document_process_rule?.rules?.parent_mode || documentDetail?.dataset_process_rule?.rules?.parent_mode || 'paragraph'
  }, [documentDetail?.document_process_rule?.rules?.parent_mode, documentDetail?.dataset_process_rule?.rules?.parent_mode])

  const isFullDocMode = useMemo(() => {
    const chunkMode = documentDetail?.doc_form
    return chunkMode === ChunkingMode.parentChild && parentMode === 'full-doc'
  }, [documentDetail?.doc_form, parentMode])

  const contextValue = useMemo(() => ({
    datasetId,
    documentId,
    docForm: documentDetail?.doc_form as ChunkingMode,
    parentMode,
  }), [datasetId, documentId, documentDetail?.doc_form, parentMode])

  const statusDetail = useMemo(() => ({
    enabled: documentDetail?.enabled || false,
    archived: documentDetail?.archived || false,
    id: documentId,
  }), [documentDetail?.enabled, documentDetail?.archived, documentId])

  const operationsDetail = useMemo(() => ({
    name: documentDetail?.name || '',
    enabled: documentDetail?.enabled || false,
    archived: documentDetail?.archived || false,
    id: documentId,
    data_source_type: documentDetail?.data_source_type || '',
    doc_form: documentDetail?.doc_form || '',
  }), [documentDetail?.name, documentDetail?.enabled, documentDetail?.archived, documentId, documentDetail?.data_source_type, documentDetail?.doc_form])

  const docDetail = useMemo(() => ({
    ...documentDetail,
    ...documentMetadata,
    doc_type: documentMetadata?.doc_type === 'others' ? '' : documentMetadata?.doc_type,
  } as FullDocumentDetail), [documentDetail, documentMetadata])

  const backButtonLabel = t('operation.back', { ns: 'common' })
  const metadataToggleLabel = `${showMetadata
    ? t('operation.close', { ns: 'common' })
    : t('operation.view', { ns: 'common' })} ${t('metadata.title', { ns: 'datasetDocuments' })}`

  return (
    <DocumentContext.Provider value={contextValue}>
      <div className="flex h-full flex-col bg-background-default">
        <div className="flex min-h-16 flex-wrap items-center justify-between border-b border-b-divider-subtle py-2.5 pr-4 pl-3">
          <button
            type="button"
            aria-label={backButtonLabel}
            title={backButtonLabel}
            onClick={backToPrev}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 hover:bg-components-button-tertiary-bg focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          >
            <span
              aria-hidden="true"
              className="i-ri-arrow-left-line h-4 w-4 text-components-button-ghost-text hover:text-text-tertiary"
            />
          </button>
          <DocumentTitle
            datasetId={datasetId}
            extension={documentUploadFile?.extension}
            name={documentDetail?.name}
            wrapperCls="mr-2"
            parent_mode={parentMode}
            chunkingMode={documentDetail?.doc_form as ChunkingMode}
          />
          <div className="flex flex-wrap items-center">
            {embeddingAvailable && documentDetail && !documentDetail.archived && !isFullDocMode && (
              <>
                <SegmentAdd
                  importStatus={importStatus}
                  clearImportStatus={resetImportStatus}
                  showNewSegmentModal={showNewSegmentModal}
                  showBatchModal={showBatchModal}
                  embedding={embedding}
                />
                <Divider type="vertical" className="mx-3! h-[14px]! bg-divider-regular!" />
              </>
            )}
            {documentDetail && (
              <StatusItem
                status={documentDetail.display_status || 'available'}
                scene="detail"
                errorMessage={documentDetail.error || ''}
                textCls="font-semibold text-xs uppercase"
                detail={statusDetail}
                datasetId={datasetId}
                onUpdate={handleOperate}
              />
            )}
            <Operations
              scene="detail"
              embeddingAvailable={embeddingAvailable}
              detail={operationsDetail}
              datasetId={datasetId}
              onUpdate={handleOperate}
              className="w-[200px]!"
            />
            <button
              type="button"
              data-testid="document-detail-metadata-toggle"
              aria-label={metadataToggleLabel}
              aria-pressed={showMetadata}
              title={metadataToggleLabel}
              className={style.layoutRightIcon}
              onClick={() => setShowMetadata(!showMetadata)}
            >
              {
                showMetadata
                  ? <span aria-hidden="true" className="i-ri-layout-left-2-line h-4 w-4 text-components-button-secondary-text" />
                  : <span aria-hidden="true" className="i-ri-layout-right-2-line h-4 w-4 text-components-button-secondary-text" />
              }
            </button>
          </div>
        </div>
        <div className="flex flex-1 flex-row" style={{ height: 'calc(100% - 4rem)' }}>
          {isDetailLoading
            ? <Loading type="app" />
            : (
                <div className={cn('flex h-full min-w-0 grow flex-col', !embedding && isFullDocMode && 'relative pt-4 pr-11 pl-11', !embedding && !isFullDocMode && 'relative pt-3 pr-11 pl-5')}>
                  {embedding
                    ? (
                        <Embedding
                          detailUpdate={detailMutate}
                          indexingType={dataset?.indexing_technique}
                          retrievalMethod={dataset?.retrieval_model_dict?.search_method}
                        />
                      )
                    : (
                        <Completed
                          embeddingAvailable={embeddingAvailable}
                          showNewSegmentModal={newSegmentModalVisible}
                          onNewSegmentModalChange={setNewSegmentModalVisible}
                          importStatus={importStatus}
                          archived={documentDetail?.archived}
                        />
                      )}
                </div>
              )}
          <FloatRightContainer showClose isOpen={showMetadata} onClose={() => setShowMetadata(false)} isMobile={isMobile} panelClassName="justify-start!">
            <Metadata
              className="mt-3 mr-2"
              datasetId={datasetId}
              documentId={documentId}
              docDetail={docDetail}
            />
          </FloatRightContainer>
        </div>
        <BatchModal
          isShow={batchModalVisible}
          onCancel={hideBatchModal}
          onConfirm={runBatch}
          docForm={documentDetail?.doc_form as ChunkingMode}
        />
      </div>
    </DocumentContext.Provider>
  )
}

export default DocumentDetail
