'use client'
import type { FC } from 'react'
import type { DataSourceInfo, FileItem, FullDocumentDetail, LegacyDataSourceInfo } from '@/models/datasets'
import { RiArrowLeftLine, RiLayoutLeft2Line, RiLayoutRight2Line } from '@remixicon/react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import FloatRightContainer from '@/app/components/base/float-right-container'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import Metadata from '@/app/components/datasets/metadata/metadata-document'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { ChunkingMode } from '@/models/datasets'
import { useDocumentDetail, useDocumentMetadata, useInvalidDocumentList } from '@/service/knowledge/use-document'
import { useCheckSegmentBatchImportProgress, useChildSegmentListKey, useSegmentBatchImport, useSegmentListKey } from '@/service/knowledge/use-segment'
import { useInvalid } from '@/service/use-base'
import { cn } from '@/utils/classnames'
import Operations from '../components/operations'
import StatusItem from '../status-item'
import BatchModal from './batch-modal'
import Completed from './completed'
import { DocumentContext } from './context'
import { DocumentTitle } from './document-title'
import Embedding from './embedding'
import SegmentAdd, { ProcessStatus } from './segment-add'
import style from './style.module.css'

type DocumentDetailProps = {
  datasetId: string
  documentId: string
}

const DocumentDetail: FC<DocumentDetailProps> = ({ datasetId, documentId }) => {
  const router = useRouter()
  const { t } = useTranslation()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const dataset = useDatasetDetailContextWithSelector(s => s.dataset)
  const embeddingAvailable = !!dataset?.embedding_available
  const [showMetadata, setShowMetadata] = useState(!isMobile)
  const [newSegmentModalVisible, setNewSegmentModalVisible] = useState(false)
  const [batchModalVisible, setBatchModalVisible] = useState(false)
  const [importStatus, setImportStatus] = useState<ProcessStatus | string>()
  const showNewSegmentModal = () => setNewSegmentModalVisible(true)
  const showBatchModal = () => setBatchModalVisible(true)
  const hideBatchModal = () => setBatchModalVisible(false)
  const resetProcessStatus = () => setImportStatus('')

  const { mutateAsync: checkSegmentBatchImportProgress } = useCheckSegmentBatchImportProgress()
  const checkProcess = async (jobID: string) => {
    await checkSegmentBatchImportProgress({ jobID }, {
      onSuccess: (res) => {
        setImportStatus(res.job_status)
        if (res.job_status === ProcessStatus.WAITING || res.job_status === ProcessStatus.PROCESSING)
          setTimeout(() => checkProcess(res.job_id), 2500)
        if (res.job_status === ProcessStatus.ERROR)
          Toast.notify({ type: 'error', message: `${t('list.batchModal.runError', { ns: 'datasetDocuments' })}` })
      },
      onError: (e) => {
        const message = 'message' in e ? `: ${e.message}` : ''
        Toast.notify({ type: 'error', message: `${t('list.batchModal.runError', { ns: 'datasetDocuments' })}${message}` })
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
        Toast.notify({ type: 'error', message: `${t('list.batchModal.runError', { ns: 'datasetDocuments' })}${message}` })
      },
    })
  }

  const { data: documentDetail, error, refetch: detailMutate } = useDocumentDetail({
    datasetId,
    documentId,
    params: { metadata: 'without' },
  })

  const { data: documentMetadata } = useDocumentMetadata({
    datasetId,
    documentId,
    params: { metadata: 'only' },
  })

  const backToPrev = () => {
    // Preserve pagination and filter states when navigating back
    const searchParams = new URLSearchParams(window.location.search)
    const queryString = searchParams.toString()
    const separator = queryString ? '?' : ''
    const backPath = `/datasets/${datasetId}/documents${separator}${queryString}`
    router.push(backPath)
  }

  const isDetailLoading = !documentDetail && !error

  const embedding = ['queuing', 'indexing', 'paused'].includes((documentDetail?.display_status || '').toLowerCase())

  const isLegacyDataSourceInfo = (info?: DataSourceInfo): info is LegacyDataSourceInfo => {
    return !!info && 'upload_file' in info
  }

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

  const handleOperate = (operateName?: string) => {
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
  }

  const parentMode = useMemo(() => {
    return documentDetail?.document_process_rule?.rules?.parent_mode || documentDetail?.dataset_process_rule?.rules?.parent_mode || 'paragraph'
  }, [documentDetail?.document_process_rule?.rules?.parent_mode, documentDetail?.dataset_process_rule?.rules?.parent_mode])

  const isFullDocMode = useMemo(() => {
    const chunkMode = documentDetail?.doc_form
    return chunkMode === ChunkingMode.parentChild && parentMode === 'full-doc'
  }, [documentDetail?.doc_form, parentMode])

  return (
    <DocumentContext.Provider value={{
      datasetId,
      documentId,
      docForm: documentDetail?.doc_form as ChunkingMode,
      parentMode,
    }}
    >
      <div className="flex h-full flex-col bg-background-default">
        <div className="flex min-h-16 flex-wrap items-center justify-between border-b border-b-divider-subtle py-2.5 pl-3 pr-4">
          <div onClick={backToPrev} className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-components-button-tertiary-bg">
            <RiArrowLeftLine className="h-4 w-4 text-components-button-ghost-text hover:text-text-tertiary" />
          </div>
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
                  clearProcessStatus={resetProcessStatus}
                  showNewSegmentModal={showNewSegmentModal}
                  showBatchModal={showBatchModal}
                  embedding={embedding}
                />
                <Divider type="vertical" className="!mx-3 !h-[14px] !bg-divider-regular" />
              </>
            )}
            <StatusItem
              status={documentDetail?.display_status || 'available'}
              scene="detail"
              errorMessage={documentDetail?.error || ''}
              textCls="font-semibold text-xs uppercase"
              detail={{
                enabled: documentDetail?.enabled || false,
                archived: documentDetail?.archived || false,
                id: documentId,
              }}
              datasetId={datasetId}
              onUpdate={handleOperate}
            />
            <Operations
              scene="detail"
              embeddingAvailable={embeddingAvailable}
              detail={{
                name: documentDetail?.name || '',
                enabled: documentDetail?.enabled || false,
                archived: documentDetail?.archived || false,
                id: documentId,
                data_source_type: documentDetail?.data_source_type || '',
                doc_form: documentDetail?.doc_form || '',
              }}
              datasetId={datasetId}
              onUpdate={handleOperate}
              className="!w-[200px]"
            />
            <button
              type="button"
              className={style.layoutRightIcon}
              onClick={() => setShowMetadata(!showMetadata)}
            >
              {
                showMetadata
                  ? <RiLayoutLeft2Line className="h-4 w-4 text-components-button-secondary-text" />
                  : <RiLayoutRight2Line className="h-4 w-4 text-components-button-secondary-text" />
              }
            </button>
          </div>
        </div>
        <div className="flex flex-1 flex-row" style={{ height: 'calc(100% - 4rem)' }}>
          {isDetailLoading
            ? <Loading type="app" />
            : (
                <div className={cn('flex h-full min-w-0 grow flex-col', !embedding && isFullDocMode && 'relative pl-11 pr-11 pt-4', !embedding && !isFullDocMode && 'relative pl-5 pr-11 pt-3')}>
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
          <FloatRightContainer showClose isOpen={showMetadata} onClose={() => setShowMetadata(false)} isMobile={isMobile} panelClassName="!justify-start" footer={null}>
            <Metadata
              className="mr-2 mt-3"
              datasetId={datasetId}
              documentId={documentId}
              docDetail={{ ...documentDetail, ...documentMetadata, doc_type: documentMetadata?.doc_type === 'others' ? '' : documentMetadata?.doc_type } as FullDocumentDetail}
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
