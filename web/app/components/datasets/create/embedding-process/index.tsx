import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { omit } from 'lodash-es'
import { ArrowRightIcon } from '@heroicons/react/24/solid'
import cn from 'classnames'
import s from './index.module.css'
import { FieldInfo } from '@/app/components/datasets/documents/detail/metadata'
import Button from '@/app/components/base/button'
import type { FullDocumentDetail, IndexingStatusResponse, ProcessRuleResponse } from '@/models/datasets'
import { formatNumber } from '@/utils/format'
import { fetchIndexingStatusBatch as doFetchIndexingStatus, fetchIndexingEstimateBatch, fetchProcessRule } from '@/service/datasets'
import { DataSourceType } from '@/models/datasets'
import NotionIcon from '@/app/components/base/notion-icon'
import PriorityLabel from '@/app/components/billing/priority-label'
import { Plan } from '@/app/components/billing/type'
import { ZapFast } from '@/app/components/base/icons/src/vender/solid/general'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useProviderContext } from '@/context/provider-context'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { AlertCircle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { sleep } from '@/utils'

type Props = {
  datasetId: string
  batchId: string
  documents?: FullDocumentDetail[]
  indexingType?: string
}

const RuleDetail: FC<{ sourceData?: ProcessRuleResponse }> = ({ sourceData }) => {
  const { t } = useTranslation()

  const segmentationRuleMap = {
    mode: t('datasetDocuments.embedding.mode'),
    segmentLength: t('datasetDocuments.embedding.segmentLength'),
    textCleaning: t('datasetDocuments.embedding.textCleaning'),
  }

  const getRuleName = (key: string) => {
    if (key === 'remove_extra_spaces')
      return t('datasetCreation.stepTwo.removeExtraSpaces')

    if (key === 'remove_urls_emails')
      return t('datasetCreation.stepTwo.removeUrlEmails')

    if (key === 'remove_stopwords')
      return t('datasetCreation.stepTwo.removeStopwords')
  }

  const getValue = useCallback((field: string) => {
    let value: string | number | undefined = '-'
    switch (field) {
      case 'mode':
        value = sourceData?.mode === 'automatic' ? (t('datasetDocuments.embedding.automatic') as string) : (t('datasetDocuments.embedding.custom') as string)
        break
      case 'segmentLength':
        value = sourceData?.rules?.segmentation?.max_tokens
        break
      default:
        value = sourceData?.mode === 'automatic'
          ? (t('datasetDocuments.embedding.automatic') as string)
          // eslint-disable-next-line array-callback-return
          : sourceData?.rules?.pre_processing_rules?.map((rule) => {
            if (rule.enabled)
              return getRuleName(rule.id)
          }).filter(Boolean).join(';')
        break
    }
    return value
  }, [sourceData])

  return <div className='flex flex-col pt-8 pb-10 first:mt-0'>
    {Object.keys(segmentationRuleMap).map((field) => {
      return <FieldInfo
        key={field}
        label={segmentationRuleMap[field as keyof typeof segmentationRuleMap]}
        displayedValue={String(getValue(field))}
      />
    })}
  </div>
}

const EmbeddingProcess: FC<Props> = ({ datasetId, batchId, documents = [], indexingType }) => {
  const { t } = useTranslation()
  const { enableBilling, plan } = useProviderContext()

  const getFirstDocument = documents[0]

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
    catch (e) {
      await sleep(2500)
      await startQueryStatus()
    }
  }

  useEffect(() => {
    startQueryStatus()
    return () => {
      stopQueryStatus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // get rule
  const { data: ruleDetail } = useSWR({
    action: 'fetchProcessRule',
    params: { documentId: getFirstDocument.id },
  }, apiParams => fetchProcessRule(omit(apiParams, 'action')), {
    revalidateOnFocus: false,
  })
  // get cost
  const { data: indexingEstimateDetail } = useSWR({
    action: 'fetchIndexingEstimateBatch',
    datasetId,
    batchId,
  }, apiParams => fetchIndexingEstimateBatch(omit(apiParams, 'action')), {
    revalidateOnFocus: false,
  })

  const router = useRouter()
  const navToDocumentList = () => {
    router.push(`/datasets/${datasetId}/documents`)
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
    return doc?.data_source_type as DataSourceType
  }

  const getIcon = (id: string) => {
    const doc = documents.find(document => document.id === id)

    return doc?.data_source_info.notion_page_icon
  }
  const isSourceEmbedding = (detail: IndexingStatusResponse) => ['indexing', 'splitting', 'parsing', 'cleaning', 'waiting'].includes(detail.indexing_status || '')

  return (
    <>
      <div className='h-5 flex justify-between items-center mb-5'>
        <div className={s.embeddingStatus}>
          {isEmbedding && t('datasetDocuments.embedding.processing')}
          {isEmbeddingCompleted && t('datasetDocuments.embedding.completed')}
        </div>
        <div className={s.cost}>
          {indexingType === 'high_quality' && (
            <div className='flex items-center'>
              <div className={cn(s.commonIcon, s.highIcon)} />
              {t('datasetDocuments.embedding.highQuality')} · {t('datasetDocuments.embedding.estimate')}
              <span className={s.tokens}>{formatNumber(indexingEstimateDetail?.tokens || 0)}</span>tokens
              (<span className={s.price}>${formatNumber(indexingEstimateDetail?.total_price || 0)}</span>)
            </div>
          )}
          {indexingType === 'economy' && (
            <div className='flex items-center'>
              <div className={cn(s.commonIcon, s.economyIcon)} />
              {t('datasetDocuments.embedding.economy')} · {t('datasetDocuments.embedding.estimate')}
              <span className={s.tokens}>0</span>tokens
            </div>
          )}
        </div>
      </div>
      {
        enableBilling && plan.type !== Plan.team && (
          <div className='flex items-center mb-3 p-3 h-14 bg-white border-[0.5px] border-black/5 shadow-md rounded-xl'>
            <div className='shrink-0 flex items-center justify-center w-8 h-8 bg-[#FFF6ED] rounded-lg'>
              <ZapFast className='w-4 h-4 text-[#FB6514]' />
            </div>
            <div className='grow mx-3 text-[13px] font-medium text-gray-700'>
              {t('billing.plansCommon.documentProcessingPriorityUpgrade')}
            </div>
            <UpgradeBtn loc='knowledge-speed-up' />
          </div>
        )
      }
      <div className={s.progressContainer}>
        {indexingStatusBatchDetail.map(indexingStatusDetail => (
          <div key={indexingStatusDetail.id} className={cn(
            s.sourceItem,
            indexingStatusDetail.indexing_status === 'error' && s.error,
            indexingStatusDetail.indexing_status === 'completed' && s.success,
          )}>
            {isSourceEmbedding(indexingStatusDetail) && (
              <div className={s.progressbar} style={{ width: `${getSourcePercent(indexingStatusDetail)}%` }} />
            )}
            <div className={`${s.info} grow`}>
              {getSourceType(indexingStatusDetail.id) === DataSourceType.FILE && (
                <div className={cn(s.fileIcon, s[getFileType(getSourceName(indexingStatusDetail.id))])} />
              )}
              {getSourceType(indexingStatusDetail.id) === DataSourceType.NOTION && (
                <NotionIcon
                  className='shrink-0 mr-1'
                  type='page'
                  src={getIcon(indexingStatusDetail.id)}
                />
              )}
              <div className={`${s.name} truncate`} title={getSourceName(indexingStatusDetail.id)}>{getSourceName(indexingStatusDetail.id)}</div>
              {
                enableBilling && (
                  <PriorityLabel />
                )
              }
            </div>
            <div className='shrink-0'>
              {isSourceEmbedding(indexingStatusDetail) && (
                <div className={s.percent}>{`${getSourcePercent(indexingStatusDetail)}%`}</div>
              )}
              {indexingStatusDetail.indexing_status === 'error' && indexingStatusDetail.error && (
                <TooltipPlus popupContent={(
                  <div className='max-w-[400px]'>
                    {indexingStatusDetail.error}
                  </div>
                )}>
                  <div className={cn(s.percent, s.error, 'flex items-center')}>
                    Error
                    <AlertCircle className='ml-1 w-4 h-4' />
                  </div>
                </TooltipPlus>
              )}
              {indexingStatusDetail.indexing_status === 'error' && !indexingStatusDetail.error && (
                <div className={cn(s.percent, s.error, 'flex items-center')}>
                  Error
                </div>
              )}
              {indexingStatusDetail.indexing_status === 'completed' && (
                <div className={cn(s.percent, s.success)}>100%</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <RuleDetail sourceData={ruleDetail} />
      <div className='flex items-center gap-2 mt-10'>
        <Button className='w-fit' type='primary' onClick={navToDocumentList}>
          <span>{t('datasetCreation.stepThree.navTo')}</span>
          <ArrowRightIcon className='h-4 w-4 ml-2 stroke-current stroke-1' />
        </Button>
      </div>
    </>
  )
}

export default EmbeddingProcess
