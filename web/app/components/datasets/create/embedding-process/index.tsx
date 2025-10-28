import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { omit } from 'lodash-es'
import {
  RiArrowRightLine,
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
import type {
  DataSourceInfo,
  FullDocumentDetail,
  IndexingStatusResponse,
  LegacyDataSourceInfo,
  ProcessRuleResponse,
} from '@/models/datasets'
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
import { useInvalidDocumentList } from '@/service/knowledge/use-document'
import Divider from '@/app/components/base/divider'
import { useDatasetApiAccessUrl } from '@/hooks/use-api-access-url'
import Link from 'next/link'

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
      displayedValue={t(`dataset.retrieval.${indexingType === IndexingType.ECONOMICAL ? 'keyword_search' : retrievalMethod}.title`) as string}
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
  }, [])

  // get rule
  const { data: ruleDetail } = useSWR({
    action: 'fetchProcessRule',
    params: { documentId: getFirstDocument.id },
  }, apiParams => fetchProcessRule(omit(apiParams, 'action')), {
    revalidateOnFocus: false,
  })

  const router = useRouter()
  const invalidDocumentList = useInvalidDocumentList()
  const navToDocumentList = () => {
    invalidDocumentList()
    router.push(`/datasets/${datasetId}/documents`)
  }
  const apiReferenceUrl = useDatasetApiAccessUrl()

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

  const isLegacyDataSourceInfo = (info: DataSourceInfo): info is LegacyDataSourceInfo => {
    return info != null && typeof (info as LegacyDataSourceInfo).upload_file === 'object'
  }

  const getIcon = (id: string) => {
    const doc = documents.find(document => document.id === id)
    const info = doc?.data_source_info
    if (info && isLegacyDataSourceInfo(info))
      return info.notion_page_icon
    return undefined
  }
  const isSourceEmbedding = (detail: IndexingStatusResponse) =>
    ['indexing', 'splitting', 'parsing', 'cleaning', 'waiting'].includes(detail.indexing_status || '')

  return (
    <>
      <div className='flex flex-col gap-y-3'>
        <div className='system-md-semibold-uppercase flex items-center gap-x-1 text-text-secondary'>
          {isEmbedding && (
            <>
              <RiLoader2Fill className='size-4 animate-spin' />
              <span>{t('datasetDocuments.embedding.processing')}</span>
            </>
          )}
          {isEmbeddingCompleted && t('datasetDocuments.embedding.completed')}
        </div>
        {
          enableBilling && plan.type !== Plan.team && (
            <div className='flex h-14 items-center rounded-xl border-[0.5px] border-black/5 bg-white p-3 shadow-md'>
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
                {getSourceType(indexingStatusDetail.id) === DataSourceType.FILE && (
                  <DocumentFileIcon
                    size='sm'
                    className='shrink-0'
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
