import type { FC, SVGProps } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { omit } from 'lodash-es'
import { ArrowRightIcon } from '@heroicons/react/24/solid'
import cn from 'classnames'
import SegmentCard from '../completed/SegmentCard'
import { FieldInfo } from '../metadata'
import style from '../completed/style.module.css'
import { DocumentContext } from '../index'
import s from './style.module.css'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import { ToastContext } from '@/app/components/base/toast'
import type { FullDocumentDetail, ProcessRuleResponse } from '@/models/datasets'
import type { CommonResponse } from '@/models/common'
import { asyncRunSafe, sleep } from '@/utils'
import { formatNumber } from '@/utils/format'
import { fetchIndexingStatus as doFetchIndexingStatus, fetchIndexingEstimate, fetchProcessRule, pauseDocIndexing, resumeDocIndexing } from '@/service/datasets'
import DatasetDetailContext from '@/context/dataset-detail'
import StopEmbeddingModal from '@/app/components/datasets/create/stop-embedding-modal'

type Props = {
  detail?: FullDocumentDetail
  stopPosition?: 'top' | 'bottom'
  datasetId?: string
  documentId?: string
  indexingType?: string
  detailUpdate: VoidFunction
}

const StopIcon = ({ className }: SVGProps<SVGElement>) => {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <g clipPath="url(#clip0_2328_2798)">
      <path d="M1.5 3.9C1.5 3.05992 1.5 2.63988 1.66349 2.31901C1.8073 2.03677 2.03677 1.8073 2.31901 1.66349C2.63988 1.5 3.05992 1.5 3.9 1.5H8.1C8.94008 1.5 9.36012 1.5 9.68099 1.66349C9.96323 1.8073 10.1927 2.03677 10.3365 2.31901C10.5 2.63988 10.5 3.05992 10.5 3.9V8.1C10.5 8.94008 10.5 9.36012 10.3365 9.68099C10.1927 9.96323 9.96323 10.1927 9.68099 10.3365C9.36012 10.5 8.94008 10.5 8.1 10.5H3.9C3.05992 10.5 2.63988 10.5 2.31901 10.3365C2.03677 10.1927 1.8073 9.96323 1.66349 9.68099C1.5 9.36012 1.5 8.94008 1.5 8.1V3.9Z" stroke="#344054" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <defs>
      <clipPath id="clip0_2328_2798">
        <rect width="12" height="12" fill="white" />
      </clipPath>
    </defs>
  </svg>
}

const ResumeIcon = ({ className }: SVGProps<SVGElement>) => {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <path d="M10 3.5H5C3.34315 3.5 2 4.84315 2 6.5C2 8.15685 3.34315 9.5 5 9.5H10M10 3.5L8 1.5M10 3.5L8 5.5" stroke="#344054" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

const RuleDetail: FC<{ sourceData?: ProcessRuleResponse; docName?: string }> = ({ sourceData, docName }) => {
  const { t } = useTranslation()

  const segmentationRuleMap = {
    docName: t('datasetDocuments.embedding.docName'),
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
      case 'docName':
        value = docName
        break
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
  }, [sourceData, docName])

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

const EmbeddingDetail: FC<Props> = ({ detail, stopPosition = 'top', datasetId: dstId, documentId: docId, indexingType, detailUpdate }) => {
  const onTop = stopPosition === 'top'
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const { datasetId = '', documentId = '' } = useContext(DocumentContext)
  const { indexingTechnique } = useContext(DatasetDetailContext)
  const localDatasetId = dstId ?? datasetId
  const localDocumentId = docId ?? documentId
  const localIndexingTechnique = indexingType ?? indexingTechnique

  const [indexingStatusDetail, setIndexingStatusDetail] = useState<any>(null)
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
    catch (e) {
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

  const { data: indexingEstimateDetail, error: indexingEstimateErr } = useSWR({
    action: 'fetchIndexingEstimate',
    datasetId: localDatasetId,
    documentId: localDocumentId,
  }, apiParams => fetchIndexingEstimate(omit(apiParams, 'action')), {
    revalidateOnFocus: false,
  })

  const { data: ruleDetail, error: ruleError } = useSWR({
    action: 'fetchProcessRule',
    params: { documentId: localDocumentId },
  }, apiParams => fetchProcessRule(omit(apiParams, 'action')), {
    revalidateOnFocus: false,
  })

  const [showModal, setShowModal] = useState(false)
  const modalShowHandle = () => setShowModal(true)
  const modalCloseHandle = () => setShowModal(false)
  const router = useRouter()
  const navToDocument = () => {
    router.push(`/datasets/${localDatasetId}/documents/${localDocumentId}`)
  }

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
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      setIndexingStatusDetail(null)
    }
    else {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
  }

  // if (!ruleDetail && !error)
  //   return <Loading type='app' />

  return (
    <>
      <div className={s.embeddingStatus}>
        {isEmbedding && t('datasetDocuments.embedding.processing')}
        {isEmbeddingCompleted && t('datasetDocuments.embedding.completed')}
        {isEmbeddingPaused && t('datasetDocuments.embedding.paused')}
        {isEmbeddingError && t('datasetDocuments.embedding.error')}
        {onTop && isEmbedding && (
          <Button onClick={handleSwitch} className={s.opBtn}>
            <StopIcon className={s.opIcon} />
            {t('datasetDocuments.embedding.stop')}
          </Button>
        )}
        {onTop && isEmbeddingPaused && (
          <Button onClick={handleSwitch} className={s.opBtn}>
            <ResumeIcon className={s.opIcon} />
            {t('datasetDocuments.embedding.resume')}
          </Button>
        )}
      </div>
      {/* progress bar */}
      <div className={s.progressContainer}>
        {new Array(10).fill('').map((_, idx) => <div
          key={idx}
          className={cn(s.progressBgItem, isEmbedding ? 'bg-primary-50' : 'bg-gray-100')}
        />)}
        <div
          className={cn(
            'rounded-l-md',
            s.progressBar,
            (isEmbedding || isEmbeddingCompleted) && s.barProcessing,
            (isEmbeddingPaused || isEmbeddingError) && s.barPaused,
            indexingStatusDetail?.indexing_status === 'completed' && 'rounded-r-md',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className={s.progressData}>
        <div>{t('datasetDocuments.embedding.segments')} {indexingStatusDetail?.completed_segments}/{indexingStatusDetail?.total_segments} · {percent}%</div>
        {localIndexingTechnique === 'high_quaility' && (
          <div className='flex items-center'>
            <div className={cn(s.commonIcon, s.highIcon)} />
            {t('datasetDocuments.embedding.highQuality')} · {t('datasetDocuments.embedding.estimate')}
            <span className={s.tokens}>{formatNumber(indexingEstimateDetail?.tokens || 0)}</span>tokens
            (<span className={s.price}>${formatNumber(indexingEstimateDetail?.total_price || 0)}</span>)
          </div>
        )}
        {localIndexingTechnique === 'economy' && (
          <div className='flex items-center'>
            <div className={cn(s.commonIcon, s.economyIcon)} />
            {t('datasetDocuments.embedding.economy')} · {t('datasetDocuments.embedding.estimate')}
            <span className={s.tokens}>0</span>tokens
          </div>
        )}
      </div>
      <RuleDetail sourceData={ruleDetail} docName={detail?.name} />
      {!onTop && (
        <div className='flex items-center gap-2 mt-10'>
          {isEmbedding && (
            <Button onClick={modalShowHandle} className='w-fit'>
              {t('datasetCreation.stepThree.stop')}
            </Button>
          )}
          {isEmbeddingPaused && (
            <Button onClick={handleSwitch} className='w-fit'>
              {t('datasetCreation.stepThree.resume')}
            </Button>
          )}
          <Button className='w-fit' variant='primary' onClick={navToDocument}>
            <span>{t('datasetCreation.stepThree.navTo')}</span>
            <ArrowRightIcon className='h-4 w-4 ml-2 stroke-current stroke-1' />
          </Button>
        </div>
      )}
      {onTop && <>
        <Divider />
        <div className={s.previewTip}>{t('datasetDocuments.embedding.previewTip')}</div>
        <div className={style.cardWrapper}>
          {[1, 2, 3].map((v, index) => (
            <SegmentCard key={index} loading={true} detail={{ position: v } as any} />
          ))}
        </div>
      </>}
      <StopEmbeddingModal show={showModal} onConfirm={handleSwitch} onHide={modalCloseHandle} />
    </>
  )
}

export default React.memo(EmbeddingDetail)
