import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  RiAedFill,
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoader2Fill,
  RiTerminalBoxLine,
} from '@remixicon/react'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import type { IndexingStatusResponse } from '@/models/datasets'
import NotionIcon from '@/app/components/base/notion-icon'
import PriorityLabel from '@/app/components/billing/priority-label'
import { Plan } from '@/app/components/billing/type'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useProviderContext } from '@/context/provider-context'
import Tooltip from '@/app/components/base/tooltip'
import { useInvalidDocumentList } from '@/service/knowledge/use-document'
import DocumentFileIcon from '@/app/components/datasets/common/document-file-icon'
import RuleDetail from './rule-detail'
import type { IndexingType } from '@/app/components/datasets/create/step-two'
import type { RETRIEVE_METHOD } from '@/types/app'
import { DatasourceType, type InitialDocumentDetail } from '@/models/pipeline'
import { useIndexingStatusBatch, useProcessRule } from '@/service/knowledge/use-dataset'
import Divider from '@/app/components/base/divider'
import { useDatasetApiAccessUrl } from '@/hooks/use-api-access-url'
import Link from 'next/link'

type EmbeddingProcessProps = {
  datasetId: string
  batchId: string
  documents?: InitialDocumentDetail[]
  indexingType?: IndexingType
  retrievalMethod?: RETRIEVE_METHOD
}

const EmbeddingProcess = ({
  datasetId,
  batchId,
  documents = [],
  indexingType,
  retrievalMethod,
}: EmbeddingProcessProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const { enableBilling, plan } = useProviderContext()
  const [indexingStatusBatchDetail, setIndexingStatusDetail] = useState<IndexingStatusResponse[]>([])
  const [shouldPoll, setShouldPoll] = useState(true)
  const { mutateAsync: fetchIndexingStatus } = useIndexingStatusBatch({ datasetId, batchId })

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>

    const fetchData = async () => {
      await fetchIndexingStatus(undefined, {
        onSuccess: (res) => {
          const indexingStatusDetailList = res.data
          setIndexingStatusDetail(indexingStatusDetailList)
          const isCompleted = indexingStatusDetailList.every(indexingStatusDetail => ['completed', 'error', 'paused'].includes(indexingStatusDetail.indexing_status))
          if (isCompleted)
            setShouldPoll(false)
        },
        onSettled: () => {
          if (shouldPoll)
            timeoutId = setTimeout(fetchData, 2500)
        },
      })
    }

    fetchData()

    return () => {
      clearTimeout(timeoutId)
    }
  }, [shouldPoll])

  // get rule
  const firstDocument = documents[0]
  const { data: ruleDetail } = useProcessRule(firstDocument.id)

  const invalidDocumentList = useInvalidDocumentList()
  const navToDocumentList = () => {
    invalidDocumentList()
    router.push(`/datasets/${datasetId}/documents`)
  }
  const apiReferenceUrl = useDatasetApiAccessUrl()

  const isEmbeddingWaiting = useMemo(() => {
    if (!indexingStatusBatchDetail.length) return false
    return indexingStatusBatchDetail.every(indexingStatusDetail => ['waiting'].includes(indexingStatusDetail?.indexing_status || ''))
  }, [indexingStatusBatchDetail])
  const isEmbedding = useMemo(() => {
    if (!indexingStatusBatchDetail.length) return false
    return indexingStatusBatchDetail.some(indexingStatusDetail => ['indexing', 'splitting', 'parsing', 'cleaning'].includes(indexingStatusDetail?.indexing_status || ''))
  }, [indexingStatusBatchDetail])
  const isEmbeddingCompleted = useMemo(() => {
    if (!indexingStatusBatchDetail.length) return false
    return indexingStatusBatchDetail.every(indexingStatusDetail => ['completed', 'error', 'paused'].includes(indexingStatusDetail?.indexing_status || ''))
  }, [indexingStatusBatchDetail])

  const getSourceName = (id: string) => {
    const doc = documents.find(document => document.id === id)
    return doc?.name
  }
  const getFileType = (name?: string) => name?.split('.').pop() || 'txt'
  const getSourcePercent = (detail: IndexingStatusResponse) => {
    const completedCount = detail.completed_segments || 0
    const totalCount = detail.total_segments || 0
    if (totalCount === 0)
      return 0
    const percent = Math.round(completedCount * 100 / totalCount)
    return percent > 100 ? 100 : percent
  }
  const getSourceType = (id: string) => {
    const doc = documents.find(document => document.id === id)
    return doc?.data_source_type
  }
  const getIcon = (id: string) => {
    const doc = documents.find(document => document.id === id)

    return doc?.data_source_info.notion_page_icon
  }
  const isSourceEmbedding = (detail: IndexingStatusResponse) =>
    ['indexing', 'splitting', 'parsing', 'cleaning', 'waiting'].includes(detail.indexing_status || '')

  return (
    <>
      <div className='flex flex-col gap-y-3'>
        <div className='system-md-semibold-uppercase flex items-center gap-x-1 text-text-secondary'>
          {(isEmbeddingWaiting || isEmbedding) && (
            <>
              <RiLoader2Fill className='size-4 animate-spin' />
              <span>
                {isEmbeddingWaiting ? t('datasetDocuments.embedding.waiting') : t('datasetDocuments.embedding.processing')}
              </span>
            </>
          )}
          {isEmbeddingCompleted && t('datasetDocuments.embedding.completed')}
        </div>
        {
          enableBilling && plan.type !== Plan.team && (
            <div className='flex h-[52px] items-center gap-x-2 rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-2.5 pl-3 shadow-xs shadow-shadow-shadow-3'>
              <div className='flex shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-brand-blue-brand-500 shadow-md shadow-shadow-shadow-5'>
                <RiAedFill className='size-4 text-text-primary-on-surface' />
              </div>
              <div className='system-md-medium grow text-text-primary'>
                {t('billing.plansCommon.documentProcessingPriorityUpgrade')}
              </div>
              <UpgradeBtn loc='knowledge-speed-up' />
            </div>
          )
        }
        <div className='flex flex-col gap-0.5 pb-2'>
          {indexingStatusBatchDetail.map(indexingStatusDetail => (
            <div
              key={indexingStatusDetail.id}
              className={cn(
                'relative h-[26px] overflow-hidden rounded-md bg-components-progress-bar-bg',
                indexingStatusDetail.indexing_status === 'error' && 'bg-state-destructive-hover-alt',
              )}
            >
              {isSourceEmbedding(indexingStatusDetail) && (
                <div
                  className='absolute left-0 top-0 h-full min-w-0.5 border-r-[2px] border-r-components-progress-bar-progress-highlight bg-components-progress-bar-progress'
                  style={{ width: `${getSourcePercent(indexingStatusDetail)}%` }}
                />
              )}
              <div className='z-[1] flex h-full items-center gap-1 pl-[6px] pr-2'>
                {getSourceType(indexingStatusDetail.id) === DatasourceType.localFile && (
                  <DocumentFileIcon
                    size='sm'
                    className='shrink-0'
                    name={getSourceName(indexingStatusDetail.id)}
                    extension={getFileType(getSourceName(indexingStatusDetail.id))}
                  />
                )}
                {getSourceType(indexingStatusDetail.id) === DatasourceType.onlineDocument && (
                  <NotionIcon
                    className='shrink-0'
                    type='page'
                    src={getIcon(indexingStatusDetail.id)}
                  />
                )}
                <div className='flex w-0 grow items-center gap-1' title={getSourceName(indexingStatusDetail.id)}>
                  <div className='system-xs-medium truncate text-text-secondary'>
                    {getSourceName(indexingStatusDetail.id)}
                  </div>
                  {
                    enableBilling && (
                      <PriorityLabel className='ml-0' />
                    )
                  }
                </div>
                {isSourceEmbedding(indexingStatusDetail) && (
                  <div className='shrink-0 text-xs text-text-secondary'>{`${getSourcePercent(indexingStatusDetail)}%`}</div>
                )}
                {indexingStatusDetail.indexing_status === 'error' && (
                  <Tooltip
                    popupClassName='px-4 py-[14px] max-w-60 body-xs-regular text-text-secondary border-[0.5px] border-components-panel-border rounded-xl'
                    offset={4}
                    popupContent={indexingStatusDetail.error}
                  >
                    <span>
                      <RiErrorWarningFill className='size-4 shrink-0 text-text-destructive' />
                    </span>
                  </Tooltip>
                )}
                {indexingStatusDetail.indexing_status === 'completed' && (
                  <RiCheckboxCircleFill className='size-4 shrink-0 text-text-success' />
                )}
              </div>
            </div>
          ))}
        </div>
        <Divider type='horizontal' className='my-0 bg-divider-subtle' />
        <RuleDetail
          sourceData={ruleDetail}
          indexingType={indexingType}
          retrievalMethod={retrievalMethod}
        />
      </div>
      <div className='mt-6 flex items-center gap-x-2 py-2'>
        <Link
          href={apiReferenceUrl}
          target='_blank'
          rel='noopener noreferrer'
        >
          <Button
            className='w-fit gap-x-0.5 px-3'
          >
            <RiTerminalBoxLine className='size-4' />
            <span className='px-0.5'>Access the API</span>
          </Button>
        </Link>
        <Button
          className='w-fit gap-x-0.5 px-3'
          variant='primary'
          onClick={navToDocumentList}
        >
          <span className='px-0.5'>{t('datasetCreation.stepThree.navTo')}</span>
          <RiArrowRightLine className='size-4 stroke-current stroke-1' />
        </Button>
      </div>
    </>
  )
}

export default EmbeddingProcess
