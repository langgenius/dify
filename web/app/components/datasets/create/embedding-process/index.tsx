import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import Image from 'next/image'
import { indexMethodIcon, retrievalIcon } from '../icons'
import { IndexingType } from '../step-two'
import DocumentFileIcon from '../../common/document-file-icon'
import cn from '@/utils/classnames'
import { FieldInfo } from '@/app/components/datasets/documents/detail/metadata'
import Button from '@/app/components/base/button'
import type { FullDocumentDetail, IndexingStatusResponse, ProcessRuleResponse } from '@/models/datasets'
import { fetchIndexingStatusBatch as doFetchIndexingStatus, fetchProcessRule } from '@/service/datasets'
import { DataSourceType, ProcessMode } from '@/models/datasets'
import NotionIcon from '@/app/components/base/notion-icon'
import PriorityLabel from '@/app/components/billing/priority-label'
import { Plan } from '@/app/components/billing/type'
import { ZapFast } from '@/app/components/base/icons/src/vender/solid/general'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useProviderContext } from '@/context/provider-context'
import { sleep } from '@/utils'
import { RETRIEVE_METHOD } from '@/types/app'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  datasetId: string
  batchId: string
  documents?: FullDocumentDetail[]
  indexingType?: string
  retrievalMethod?: string
}

const RuleDetail: FC<{
  sourceData?: ProcessRuleResponse
  indexingType?: string
  retrievalMethod?: string
}> = ({ sourceData, indexingType, retrievalMethod }) => {
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

  const isNumber = (value: unknown) => {
    return typeof value === 'number'
  }

  const getValue = useCallback((field: string) => {
    let value: string | number | undefined = '-'
    const maxTokens = isNumber(sourceData?.rules?.segmentation?.max_tokens)
      ? sourceData.rules.segmentation.max_tokens
      : value
    const childMaxTokens = isNumber(sourceData?.rules?.subchunk_segmentation?.max_tokens)
      ? sourceData.rules.subchunk_segmentation.max_tokens
      : value
    switch (field) {
      case 'mode':
        value = !sourceData?.mode
          ? value
          : sourceData.mode === ProcessMode.general
            ? (t('datasetDocuments.embedding.custom') as string)
            : `${t('datasetDocuments.embedding.hierarchical')} · ${sourceData?.rules?.parent_mode === 'paragraph'
              ? t('dataset.parentMode.paragraph')
              : t('dataset.parentMode.fullDoc')}`
        break
      case 'segmentLength':
        value = !sourceData?.mode
          ? value
          : sourceData.mode === ProcessMode.general
            ? maxTokens
            : `${t('datasetDocuments.embedding.parentMaxTokens')} ${maxTokens}; ${t('datasetDocuments.embedding.childMaxTokens')} ${childMaxTokens}`
        break
      default:
        value = !sourceData?.mode
          ? value
          : sourceData?.rules?.pre_processing_rules?.filter(rule =>
            rule.enabled).map(rule => getRuleName(rule.id)).join(',')
        break
    }
    return value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceData])

  return <div className='flex flex-col gap-1'>
    {Object.keys(segmentationRuleMap).map((field) => {
      return <FieldInfo
        key={field}
        label={segmentationRuleMap[field as keyof typeof segmentationRuleMap]}
        displayedValue={String(getValue(field))}
      />
    })}
    <FieldInfo
      label={t('datasetCreation.stepTwo.indexMode')}
      displayedValue={t(`datasetCreation.stepTwo.${indexingType === IndexingType.ECONOMICAL ? 'economical' : 'qualified'}`) as string}
      valueIcon={
        <Image
          className='size-4'
          src={
            indexingType === IndexingType.ECONOMICAL
              ? indexMethodIcon.economical
              : indexMethodIcon.high_quality
          }
          alt=''
        />
      }
    />
    <FieldInfo
      label={t('datasetSettings.form.retrievalSetting.title')}
      // displayedValue={t(`datasetSettings.form.retrievalSetting.${retrievalMethod}`) as string}
      displayedValue={t(`dataset.retrieval.${indexingType === IndexingType.ECONOMICAL ? 'invertedIndex' : retrievalMethod}.title`) as string}
      valueIcon={
        <Image
          className='size-4'
          src={
            retrievalMethod === RETRIEVE_METHOD.fullText
              ? retrievalIcon.fullText
              : retrievalMethod === RETRIEVE_METHOD.hybrid
                ? retrievalIcon.hybrid
                : retrievalIcon.vector
          }
          alt=''
        />
      }
    />
  </div>
}

const EmbeddingProcess: FC<Props> = ({ datasetId, batchId, documents = [], indexingType, retrievalMethod }) => {
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
    params: { documentId: getFirstDocument.id },
  }, apiParams => fetchProcessRule(omit(apiParams, 'action')), {
    revalidateOnFocus: false,
  })

  const router = useRouter()
  const navToDocumentList = () => {
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
    return doc?.data_source_type as DataSourceType
  }

  const getIcon = (id: string) => {
    const doc = documents.find(document => document.id === id)

    return doc?.data_source_info.notion_page_icon
  }
  const isSourceEmbedding = (detail: IndexingStatusResponse) =>
    ['indexing', 'splitting', 'parsing', 'cleaning', 'waiting'].includes(detail.indexing_status || '')

  return (
    <>
      <div className="h-5 flex items-center mb-3">
        <div className="flex items-center justify-between text-gray-900 font-medium text-sm mr-2">
          {isEmbedding && <div className='flex items-center'>
            <RiLoader2Fill className='size-4 mr-1 animate-spin' />
            {t('datasetDocuments.embedding.processing')}
          </div>}
          {isEmbeddingCompleted && t('datasetDocuments.embedding.completed')}
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
      <div className="flex flex-col gap-0.5 pb-2">
        {indexingStatusBatchDetail.map(indexingStatusDetail => (
          <div key={indexingStatusDetail.id} className={cn(
            'relative h-[26px] bg-components-progress-bar-bg rounded-md overflow-hidden',
            indexingStatusDetail.indexing_status === 'error' && 'bg-state-destructive-hover-alt',
            // indexingStatusDetail.indexing_status === 'completed' && 's.success',
          )}>
            {isSourceEmbedding(indexingStatusDetail) && (
              <div className="absolute top-0 left-0 h-full min-w-0.5 bg-components-progress-bar-progress border-r-[2px] border-r-components-progress-bar-progress-highlight" style={{ width: `${getSourcePercent(indexingStatusDetail)}%` }} />
            )}
            <div className="flex gap-1 pl-[6px] pr-2 h-full items-center z-[1]">
              {getSourceType(indexingStatusDetail.id) === DataSourceType.FILE && (
                // <div className={cn(
                //   'shrink-0 marker:size-4 bg-center bg-no-repeat bg-contain',
                //   s[getFileType(getSourceName(indexingStatusDetail.id))] || s.unknownFileIcon,
                // )} />
                <DocumentFileIcon
                  className="shrink-0 size-4"
                  name={getSourceName(indexingStatusDetail.id)}
                  extension={getFileType(getSourceName(indexingStatusDetail.id))}
                />
              )}
              {getSourceType(indexingStatusDetail.id) === DataSourceType.NOTION && (
                <NotionIcon
                  className='shrink-0'
                  type='page'
                  src={getIcon(indexingStatusDetail.id)}
                />
              )}
              <div className="grow flex items-center gap-1 w-0" title={getSourceName(indexingStatusDetail.id)}>
                <div className="text-xs truncate">
                  {getSourceName(indexingStatusDetail.id)}
                </div>
                {
                  enableBilling && (
                    <PriorityLabel className='ml-0' />
                  )
                }
              </div>
              {isSourceEmbedding(indexingStatusDetail) && (
                <div className="shrink-0 text-xs">{`${getSourcePercent(indexingStatusDetail)}%`}</div>
              )}
              {indexingStatusDetail.indexing_status === 'error' && (
                <Tooltip
                  popupClassName='px-4 py-[14px] max-w-60 text-sm leading-4 text-text-secondary border-[0.5px] border-components-panel-border rounded-xl'
                  offset={4}
                  popupContent={indexingStatusDetail.error}
                >
                  <span>
                    <RiErrorWarningFill className='shrink-0 size-4 text-text-destructive' />
                  </span>
                </Tooltip>
              )}
              {indexingStatusDetail.indexing_status === 'completed' && (
                <RiCheckboxCircleFill className='shrink-0 size-4 text-text-success' />
              )}
            </div>
          </div>
        ))}
      </div>
      <hr className="my-3 h-[1px] bg-divider-subtle border-0" />
      <RuleDetail
        sourceData={ruleDetail}
        indexingType={indexingType}
        retrievalMethod={retrievalMethod}
      />
      <div className='flex items-center gap-2 my-10'>
        <Button className='w-fit' onClick={navToApiDocs}>
          <RiTerminalBoxLine className='size-4 mr-2' />
          <span>Access the API</span>
        </Button>
        <Button className='w-fit' variant='primary' onClick={navToDocumentList}>
          <span>{t('datasetCreation.stepThree.navTo')}</span>
          <ArrowRightIcon className='size-4 ml-2 stroke-current stroke-1' />
        </Button>
      </div>
    </>
  )
}

export default EmbeddingProcess
