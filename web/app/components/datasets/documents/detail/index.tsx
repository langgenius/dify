'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { RiArrowLeftLine, RiLayoutRight2Line } from '@remixicon/react'
import { OperationAction, StatusItem } from '../list'
import DocumentPicker from '../../common/document-picker'
import Completed from './completed'
import Embedding from './embedding'
import Metadata from './metadata'
import SegmentAdd, { ProcessStatus } from './segment-add'
import BatchModal from './batch-modal'
import style from './style.module.css'
import cn from '@/utils/classnames'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import { ToastContext } from '@/app/components/base/toast'
import type { ChunkingMode, ParentMode, ProcessMode } from '@/models/datasets'
import { useDatasetDetailContext } from '@/context/dataset-detail'
import FloatRightContainer from '@/app/components/base/float-right-container'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { LayoutRight2LineMod } from '@/app/components/base/icons/src/public/knowledge'
import { useCheckSegmentBatchImportProgress, useChildSegmentListKey, useSegmentBatchImport, useSegmentListKey } from '@/service/knowledge/use-segment'
import { useDocumentDetail, useDocumentMetadata } from '@/service/knowledge/use-document'
import { useInvalid } from '@/service/use-base'

type DocumentContextValue = {
  datasetId?: string
  documentId?: string
  docForm: string
  mode?: ProcessMode
  parentMode?: ParentMode
}

export const DocumentContext = createContext<DocumentContextValue>({ docForm: '' })

export const useDocumentContext = (selector: (value: DocumentContextValue) => any) => {
  return useContextSelector(DocumentContext, selector)
}

type DocumentTitleProps = {
  datasetId: string
  extension?: string
  name?: string
  processMode?: ProcessMode
  parent_mode?: ParentMode
  iconCls?: string
  textCls?: string
  wrapperCls?: string
}

export const DocumentTitle: FC<DocumentTitleProps> = ({ datasetId, extension, name, processMode, parent_mode, wrapperCls }) => {
  const router = useRouter()
  return (
    <div className={cn('flex flex-1 items-center justify-start', wrapperCls)}>
      <DocumentPicker
        datasetId={datasetId}
        value={{
          name,
          extension,
          processMode,
          parentMode: parent_mode,
        }}
        onChange={(doc) => {
          router.push(`/datasets/${datasetId}/documents/${doc.id}`)
        }}
      />
    </div>
  )
}

type Props = {
  datasetId: string
  documentId: string
}

const DocumentDetail: FC<Props> = ({ datasetId, documentId }) => {
  const router = useRouter()
  const { t } = useTranslation()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const { notify } = useContext(ToastContext)
  const { dataset } = useDatasetDetailContext()
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
          notify({ type: 'error', message: `${t('datasetDocuments.list.batchModal.runError')}` })
      },
      onError: (e) => {
        notify({ type: 'error', message: `${t('datasetDocuments.list.batchModal.runError')}${'message' in e ? `: ${e.message}` : ''}` })
      },
    })
  }

  const { mutateAsync: segmentBatchImport } = useSegmentBatchImport()
  const runBatch = async (csv: File) => {
    const formData = new FormData()
    formData.append('file', csv)
    await segmentBatchImport({
      url: `/datasets/${datasetId}/documents/${documentId}/segments/batch_import`,
      body: formData,
    }, {
      onSuccess: (res) => {
        setImportStatus(res.job_status)
        checkProcess(res.job_id)
      },
      onError: (e) => {
        notify({ type: 'error', message: `${t('datasetDocuments.list.batchModal.runError')}${'message' in e ? `: ${e.message}` : ''}` })
      },
    })
  }

  const { data: documentDetail, error, refetch: detailMutate } = useDocumentDetail({
    datasetId,
    documentId,
    params: { metadata: 'without' },
  })

  const { data: documentMetadata, error: metadataErr, refetch: metadataMutate } = useDocumentMetadata({
    datasetId,
    documentId,
    params: { metadata: 'only' },
  })

  const backToPrev = () => {
    router.push(`/datasets/${datasetId}/documents`)
  }

  const isDetailLoading = !documentDetail && !error
  const isMetadataLoading = !documentMetadata && !metadataErr

  const embedding = ['queuing', 'indexing', 'paused'].includes((documentDetail?.display_status || '').toLowerCase())

  const invalidChunkList = useInvalid(useSegmentListKey)
  const invalidChildChunkList = useInvalid(useChildSegmentListKey)

  const handleOperate = (operateName?: string) => {
    if (operateName === 'delete') {
      backToPrev()
    }
    else {
      detailMutate()
      setTimeout(() => {
        invalidChunkList()
        invalidChildChunkList()
      }, 5000)
    }
  }

  const mode = useMemo(() => {
    return documentDetail?.document_process_rule?.mode
  }, [documentDetail?.document_process_rule])

  const parentMode = useMemo(() => {
    return documentDetail?.document_process_rule?.rules?.parent_mode
  }, [documentDetail?.document_process_rule])

  const isFullDocMode = useMemo(() => {
    return mode === 'hierarchical' && parentMode === 'full-doc'
  }, [mode, parentMode])

  return (
    <DocumentContext.Provider value={{
      datasetId,
      documentId,
      docForm: documentDetail?.doc_form || '',
      mode,
      parentMode,
    }}>
      <div className='bg-background-default flex h-full flex-col'>
        <div className='border-b-divider-subtle flex min-h-16 flex-wrap items-center justify-between border-b py-2.5 pl-3 pr-4'>
          <div onClick={backToPrev} className={'hover:bg-components-button-tertiary-bg flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full'}>
            <RiArrowLeftLine className='text-components-button-ghost-text hover:text-text-tertiary h-4 w-4' />
          </div>
          <DocumentTitle
            datasetId={datasetId}
            extension={documentDetail?.data_source_info?.upload_file?.extension}
            name={documentDetail?.name}
            wrapperCls='mr-2'
            parent_mode={parentMode}
            processMode={mode}
          />
          <div className='flex flex-wrap items-center'>
            {embeddingAvailable && documentDetail && !documentDetail.archived && !isFullDocMode && (
              <>
                <SegmentAdd
                  importStatus={importStatus}
                  clearProcessStatus={resetProcessStatus}
                  showNewSegmentModal={showNewSegmentModal}
                  showBatchModal={showBatchModal}
                  embedding={embedding}
                />
                <Divider type='vertical' className='!bg-divider-regular !mx-3 !h-[14px]' />
              </>
            )}
            <StatusItem
              status={documentDetail?.display_status || 'available'}
              scene='detail'
              errorMessage={documentDetail?.error || ''}
              textCls='font-semibold text-xs uppercase'
              detail={{
                enabled: documentDetail?.enabled || false,
                archived: documentDetail?.archived || false,
                id: documentId,
              }}
              datasetId={datasetId}
              onUpdate={handleOperate}
            />
            <OperationAction
              scene='detail'
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
              className='!w-[200px]'
            />
            <button
              className={style.layoutRightIcon}
              onClick={() => setShowMetadata(!showMetadata)}
            >
              {
                showMetadata
                  ? <LayoutRight2LineMod className='text-components-button-secondary-text h-4 w-4' />
                  : <RiLayoutRight2Line className='text-components-button-secondary-text h-4 w-4' />
              }
            </button>
          </div>
        </div>
        <div className='flex flex-1 flex-row' style={{ height: 'calc(100% - 4rem)' }}>
          {isDetailLoading
            ? <Loading type='app' />
            : <div className={cn('flex h-full min-w-0 grow flex-col',
              embedding ? '' : isFullDocMode ? 'relative pl-11 pr-11 pt-4' : 'relative pl-5 pr-11 pt-3',
            )}>
              {embedding
                ? <Embedding
                  detailUpdate={detailMutate}
                  indexingType={dataset?.indexing_technique}
                  retrievalMethod={dataset?.retrieval_model_dict?.search_method}
                />
                : <Completed
                  embeddingAvailable={embeddingAvailable}
                  showNewSegmentModal={newSegmentModalVisible}
                  onNewSegmentModalChange={setNewSegmentModalVisible}
                  importStatus={importStatus}
                  archived={documentDetail?.archived}
                />
              }
            </div>
          }
          <FloatRightContainer showClose isOpen={showMetadata} onClose={() => setShowMetadata(false)} isMobile={isMobile} panelClassname='!justify-start' footer={null}>
            <Metadata
              docDetail={{ ...documentDetail, ...documentMetadata, doc_type: documentMetadata?.doc_type === 'others' ? '' : documentMetadata?.doc_type } as any}
              loading={isMetadataLoading}
              onUpdate={metadataMutate}
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
