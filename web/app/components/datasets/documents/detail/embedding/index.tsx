import type { FC } from 'react'
import type { CommonResponse } from '@/models/common'
import type { IndexingStatusResponse, ProcessRuleResponse } from '@/models/datasets'
import { RiLoader2Line, RiPauseCircleLine, RiPlayCircleLine } from '@remixicon/react'
import Image from 'next/image'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Divider from '@/app/components/base/divider'
import { ToastContext } from '@/app/components/base/toast'
import { ProcessMode } from '@/models/datasets'
import {
  fetchIndexingStatus as doFetchIndexingStatus,
  pauseDocIndexing,
  resumeDocIndexing,
} from '@/service/datasets'
import { useProcessRule } from '@/service/knowledge/use-dataset'
import { RETRIEVE_METHOD } from '@/types/app'
import { asyncRunSafe, sleep } from '@/utils'
import { cn } from '@/utils/classnames'
import { indexMethodIcon, retrievalIcon } from '../../../create/icons'
import { IndexingType } from '../../../create/step-two'
import { useDocumentContext } from '../context'
import { FieldInfo } from '../metadata'
import EmbeddingSkeleton from './skeleton'

type IEmbeddingDetailProps = {
  datasetId?: string
  documentId?: string
  indexingType?: IndexingType
  retrievalMethod?: RETRIEVE_METHOD
  detailUpdate: VoidFunction
}

type IRuleDetailProps = {
  sourceData?: ProcessRuleResponse
  indexingType?: IndexingType
  retrievalMethod?: RETRIEVE_METHOD
}

const RuleDetail: FC<IRuleDetailProps> = React.memo(({
  sourceData,
  indexingType,
  retrievalMethod,
}) => {
  const { t } = useTranslation()

  const segmentationRuleMap = {
    mode: t('embedding.mode', { ns: 'datasetDocuments' }),
    segmentLength: t('embedding.segmentLength', { ns: 'datasetDocuments' }),
    textCleaning: t('embedding.textCleaning', { ns: 'datasetDocuments' }),
  }

  const getRuleName = (key: string) => {
    if (key === 'remove_extra_spaces')
      return t('stepTwo.removeExtraSpaces', { ns: 'datasetCreation' })

    if (key === 'remove_urls_emails')
      return t('stepTwo.removeUrlEmails', { ns: 'datasetCreation' })

    if (key === 'remove_stopwords')
      return t('stepTwo.removeStopwords', { ns: 'datasetCreation' })
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
            ? (t('embedding.custom', { ns: 'datasetDocuments' }) as string)
            : `${t('embedding.hierarchical', { ns: 'datasetDocuments' })} · ${sourceData?.rules?.parent_mode === 'paragraph'
              ? t('parentMode.paragraph', { ns: 'dataset' })
              : t('parentMode.fullDoc', { ns: 'dataset' })}`
        break
      case 'segmentLength':
        value = !sourceData?.mode
          ? value
          : sourceData.mode === ProcessMode.general
            ? maxTokens
            : `${t('embedding.parentMaxTokens', { ns: 'datasetDocuments' })} ${maxTokens}; ${t('embedding.childMaxTokens', { ns: 'datasetDocuments' })} ${childMaxTokens}`
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

  return (
    <div className="py-3">
      <div className="flex flex-col gap-y-1">
        {Object.keys(segmentationRuleMap).map((field) => {
          return (
            <FieldInfo
              key={field}
              label={segmentationRuleMap[field as keyof typeof segmentationRuleMap]}
              displayedValue={String(getValue(field))}
            />
          )
        })}
      </div>
      <Divider type="horizontal" className="bg-divider-subtle" />
      <FieldInfo
        label={t('stepTwo.indexMode', { ns: 'datasetCreation' })}
        displayedValue={t(`stepTwo.${indexingType === IndexingType.ECONOMICAL ? 'economical' : 'qualified'}`, { ns: 'datasetCreation' }) as string}
        valueIcon={(
          <Image
            className="size-4"
            src={
              indexingType === IndexingType.ECONOMICAL
                ? indexMethodIcon.economical
                : indexMethodIcon.high_quality
            }
            alt=""
          />
        )}
      />
      <FieldInfo
        label={t('form.retrievalSetting.title', { ns: 'datasetSettings' })}
        displayedValue={t(`retrieval.${indexingType === IndexingType.ECONOMICAL ? 'keyword_search' : retrievalMethod ?? 'semantic_search'}.title`, { ns: 'dataset' })}
        valueIcon={(
          <Image
            className="size-4"
            src={
              retrievalMethod === RETRIEVE_METHOD.fullText
                ? retrievalIcon.fullText
                : retrievalMethod === RETRIEVE_METHOD.hybrid
                  ? retrievalIcon.hybrid
                  : retrievalIcon.vector
            }
            alt=""
          />
        )}
      />
    </div>
  )
})

RuleDetail.displayName = 'RuleDetail'

const EmbeddingDetail: FC<IEmbeddingDetailProps> = ({
  datasetId: dstId,
  documentId: docId,
  detailUpdate,
  indexingType,
  retrievalMethod,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const datasetId = useDocumentContext(s => s.datasetId)
  const documentId = useDocumentContext(s => s.documentId)
  const localDatasetId = dstId ?? datasetId
  const localDocumentId = docId ?? documentId

  const [indexingStatusDetail, setIndexingStatusDetail] = useState<IndexingStatusResponse | null>(null)
  const fetchIndexingStatus = async () => {
    const status = await doFetchIndexingStatus({ datasetId: localDatasetId, documentId: localDocumentId })
    setIndexingStatusDetail(status)
    return status
  }

  const isStopQuery = useRef(false)
  const stopQueryStatus = useCallback(() => {
    isStopQuery.current = true
  }, [])

  const startQueryStatus = useCallback(async () => {
    if (isStopQuery.current)
      return

    try {
      const indexingStatusDetail = await fetchIndexingStatus()
      if (['completed', 'error', 'paused'].includes(indexingStatusDetail?.indexing_status)) {
        stopQueryStatus()
        detailUpdate()
        return
      }

      await sleep(2500)
      await startQueryStatus()
    }
    catch {
      await sleep(2500)
      await startQueryStatus()
    }
  }, [stopQueryStatus])

  useEffect(() => {
    isStopQuery.current = false
    startQueryStatus()
    return () => {
      stopQueryStatus()
    }
  }, [startQueryStatus, stopQueryStatus])

  const { data: ruleDetail } = useProcessRule(localDocumentId)

  const isEmbedding = useMemo(() => ['indexing', 'splitting', 'parsing', 'cleaning'].includes(indexingStatusDetail?.indexing_status || ''), [indexingStatusDetail])
  const isEmbeddingCompleted = useMemo(() => ['completed'].includes(indexingStatusDetail?.indexing_status || ''), [indexingStatusDetail])
  const isEmbeddingPaused = useMemo(() => ['paused'].includes(indexingStatusDetail?.indexing_status || ''), [indexingStatusDetail])
  const isEmbeddingError = useMemo(() => ['error'].includes(indexingStatusDetail?.indexing_status || ''), [indexingStatusDetail])
  const percent = useMemo(() => {
    const completedCount = indexingStatusDetail?.completed_segments || 0
    const totalCount = indexingStatusDetail?.total_segments || 0
    if (totalCount === 0)
      return 0
    const percent = Math.round(completedCount * 100 / totalCount)
    return percent > 100 ? 100 : percent
  }, [indexingStatusDetail])

  const handleSwitch = async () => {
    const opApi = isEmbedding ? pauseDocIndexing : resumeDocIndexing
    const [e] = await asyncRunSafe<CommonResponse>(opApi({ datasetId: localDatasetId, documentId: localDocumentId }) as Promise<CommonResponse>)
    if (!e) {
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
      // if the embedding is resumed from paused, we need to start the query status
      if (isEmbeddingPaused) {
        isStopQuery.current = false
        startQueryStatus()
        detailUpdate()
      }
      setIndexingStatusDetail(null)
    }
    else {
      notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
    }
  }

  return (
    <>
      <div className="flex flex-col gap-y-2 px-16 py-12">
        <div className="flex h-6 items-center gap-x-1">
          {isEmbedding && <RiLoader2Line className="h-4 w-4 animate-spin text-text-secondary" />}
          <span className="system-md-semibold-uppercase grow text-text-secondary">
            {isEmbedding && t('embedding.processing', { ns: 'datasetDocuments' })}
            {isEmbeddingCompleted && t('embedding.completed', { ns: 'datasetDocuments' })}
            {isEmbeddingPaused && t('embedding.paused', { ns: 'datasetDocuments' })}
            {isEmbeddingError && t('embedding.error', { ns: 'datasetDocuments' })}
          </span>
          {isEmbedding && (
            <button
              type="button"
              className={`flex items-center gap-x-1 rounded-md border-[0.5px]
              border-components-button-secondary-border bg-components-button-secondary-bg px-1.5 py-1 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]`}
              onClick={handleSwitch}
            >
              <RiPauseCircleLine className="h-3.5 w-3.5 text-components-button-secondary-text" />
              <span className="system-xs-medium pr-[3px] text-components-button-secondary-text">
                {t('embedding.pause', { ns: 'datasetDocuments' })}
              </span>
            </button>
          )}
          {isEmbeddingPaused && (
            <button
              type="button"
              className={`flex items-center gap-x-1 rounded-md border-[0.5px]
              border-components-button-secondary-border bg-components-button-secondary-bg px-1.5 py-1 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]`}
              onClick={handleSwitch}
            >
              <RiPlayCircleLine className="h-3.5 w-3.5 text-components-button-secondary-text" />
              <span className="system-xs-medium pr-[3px] text-components-button-secondary-text">
                {t('embedding.resume', { ns: 'datasetDocuments' })}
              </span>
            </button>
          )}
        </div>
        {/* progress bar */}
        <div className={cn(
          'flex h-2 w-full items-center overflow-hidden rounded-md border border-components-progress-bar-border',
          isEmbedding ? 'bg-components-progress-bar-bg/50' : 'bg-components-progress-bar-bg',
        )}
        >
          <div
            className={cn(
              'h-full',
              (isEmbedding || isEmbeddingCompleted) && 'bg-components-progress-bar-progress-solid',
              (isEmbeddingPaused || isEmbeddingError) && 'bg-components-progress-bar-progress-highlight',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex w-full items-center">
          <span className="system-xs-medium text-text-secondary">
            {`${t('embedding.segments', { ns: 'datasetDocuments' })} ${indexingStatusDetail?.completed_segments || '--'}/${indexingStatusDetail?.total_segments || '--'} · ${percent}%`}
          </span>
        </div>
        <RuleDetail sourceData={ruleDetail} indexingType={indexingType} retrievalMethod={retrievalMethod} />
      </div>
      <EmbeddingSkeleton />
    </>
  )
}

export default React.memo(EmbeddingDetail)
