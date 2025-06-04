import React, { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { omit } from 'lodash-es'
import { ArrowRightIcon } from '@heroicons/react/24/solid'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoader2Fill,
  RiTerminalBoxLine,
} from '@remixicon/react'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import type { IndexingStatusResponse } from '@/models/datasets'
import { fetchIndexingStatusBatch as doFetchIndexingStatus, fetchProcessRule } from '@/service/datasets'
import NotionIcon from '@/app/components/base/notion-icon'
import PriorityLabel from '@/app/components/billing/priority-label'
import { Plan } from '@/app/components/billing/type'
import { ZapFast } from '@/app/components/base/icons/src/vender/solid/general'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useProviderContext } from '@/context/provider-context'
import { sleep } from '@/utils'
import Tooltip from '@/app/components/base/tooltip'
import { useInvalidDocumentList } from '@/service/knowledge/use-document'
import DocumentFileIcon from '@/app/components/datasets/common/document-file-icon'
import RuleDetail from './rule-detail'
import type { IndexingType } from '@/app/components/datasets/create/step-two'
import type { RETRIEVE_METHOD } from '@/types/app'
import { DatasourceType, type InitialDocumentDetail } from '@/models/pipeline'

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
  const { enableBilling, plan } = useProviderContext()

  const firstDocument = documents[0]

  const [indexingStatusBatchDetail, setIndexingStatusDetail] = useState<IndexingStatusResponse[]>([])
  const fetchIndexingStatus = async () => {
    const status = await doFetchIndexingStatus({ datasetId, batchId })
    setIndexingStatusDetail(status.data)
    return status.data
  }

  const [isStopQuery, setIsStopQuery] = useState(false)
  const isStopQueryRef = useRef(isStopQuery)
  useEffect(() => {
    isStopQueryRef.current = isStopQuery
  }, [isStopQuery])
  const stopQueryStatus = () => {
    setIsStopQuery(true)
  }

  const startQueryStatus = async () => {
    if (isStopQueryRef.current)
      return

    try {
      const indexingStatusBatchDetail = await fetchIndexingStatus()
      const isCompleted = indexingStatusBatchDetail.every(indexingStatusDetail => ['completed', 'error', 'paused'].includes(indexingStatusDetail.indexing_status))
      if (isCompleted) {
        stopQueryStatus()
        return
      }
      await sleep(2500)
      await startQueryStatus()
    }
    catch {
      await sleep(2500)
      await startQueryStatus()
    }
  }

  useEffect(() => {
    setIsStopQuery(false)
    startQueryStatus()
    return () => {
      stopQueryStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // get rule
  const { data: ruleDetail } = useSWR({
    action: 'fetchProcessRule',
    params: { documentId: firstDocument.id },
  }, apiParams => fetchProcessRule(omit(apiParams, 'action')), {
    revalidateOnFocus: false,
  })

  const router = useRouter()
  const invalidDocumentList = useInvalidDocumentList()
  const navToDocumentList = () => {
    invalidDocumentList()
    router.push(`/datasets/${datasetId}/documents`)
  }
  const navToApiDocs = () => {
    router.push('/datasets?category=api')
  }

  const isEmbedding = useMemo(() => {
    return indexingStatusBatchDetail.some(indexingStatusDetail => ['indexing', 'splitting', 'parsing', 'cleaning'].includes(indexingStatusDetail?.indexing_status || ''))
  }, [indexingStatusBatchDetail])
  const isEmbeddingCompleted = useMemo(() => {
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
      <div className='mb-3 flex h-5 items-center'>
        <div className='mr-2 flex items-center justify-between text-sm font-medium text-text-secondary'>
          {isEmbedding && <div className='flex items-center'>
            <RiLoader2Fill className='mr-1 size-4 animate-spin text-text-secondary' />
            {t('datasetDocuments.embedding.processing')}
          </div>}
          {isEmbeddingCompleted && t('datasetDocuments.embedding.completed')}
        </div>
      </div>
      {
        enableBilling && plan.type !== Plan.team && (
          <div className='mb-3 flex h-14 items-center rounded-xl border-[0.5px] border-black/5 bg-white p-3 shadow-md'>
            <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFF6ED]'>
              <ZapFast className='h-4 w-4 text-[#FB6514]' />
            </div>
            <div className='mx-3 grow text-[13px] font-medium text-gray-700'>
              {t('billing.plansCommon.documentProcessingPriorityUpgrade')}
            </div>
            <UpgradeBtn loc='knowledge-speed-up' />
          </div>
        )
      }
      <div className='flex flex-col gap-0.5 pb-2'>
        {indexingStatusBatchDetail.map(indexingStatusDetail => (
          <div key={indexingStatusDetail.id} className={cn(
            'relative h-[26px] overflow-hidden rounded-md bg-components-progress-bar-bg',
            indexingStatusDetail.indexing_status === 'error' && 'bg-state-destructive-hover-alt',
          )}>
            {isSourceEmbedding(indexingStatusDetail) && (
              <div className='absolute left-0 top-0 h-full min-w-0.5 border-r-[2px] border-r-components-progress-bar-progress-highlight bg-components-progress-bar-progress' style={{ width: `${getSourcePercent(indexingStatusDetail)}%` }} />
            )}
            <div className='z-[1] flex h-full items-center gap-1 pl-[6px] pr-2'>
              {getSourceType(indexingStatusDetail.id) === DatasourceType.localFile && (
                <DocumentFileIcon
                  className='size-4 shrink-0'
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
                  popupClassName='px-4 py-[14px] max-w-60 text-sm leading-4 text-text-secondary border-[0.5px] border-components-panel-border rounded-xl'
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
      <hr className='my-3 h-[1px] border-0 bg-divider-subtle' />
      <RuleDetail
        sourceData={ruleDetail}
        indexingType={indexingType}
        retrievalMethod={retrievalMethod}
      />
      <div className='my-10 flex items-center gap-2'>
        <Button className='w-fit' onClick={navToApiDocs}>
          <RiTerminalBoxLine className='mr-2 size-4' />
          <span>Access the API</span>
        </Button>
        <Button className='w-fit' variant='primary' onClick={navToDocumentList}>
          <span>{t('datasetCreation.stepThree.navTo')}</span>
          <ArrowRightIcon className='ml-2 size-4 stroke-current stroke-1' />
        </Button>
      </div>
    </>
  )
}

export default EmbeddingProcess
