'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiBookOpenLine } from '@remixicon/react'
import type { FullDocumentDetail, InitialDocumentDetail } from '@/models/datasets'
import EmbeddingProcess from '../../../create/embedding-process'
import { useGetDocLanguage } from '@/context/i18n'

type ProcessingProps = {
  datasetId: string
  indexingType: string
  retrievalMethod: string
  batchId: string
  documents: InitialDocumentDetail[]
}

const Processing = ({
  datasetId,
  batchId,
  documents,
  indexingType,
  retrievalMethod,
}: ProcessingProps) => {
  const { t } = useTranslation()
  const docLanguage = useGetDocLanguage()

  return (
    <div className='flex h-full w-full justify-center overflow-hidden'>
      <div className='h-full w-3/5 overflow-y-auto pb-8 pt-10'>
        <div className='max-w-[640px]'>
          <EmbeddingProcess
            datasetId={datasetId}
            batchId={batchId || ''}
            documents={documents as FullDocumentDetail[]}
            indexingType={indexingType}
            retrievalMethod={retrievalMethod}
          />
        </div>
      </div>
      <div className='w-2/5 pr-8 pt-[88px]'>
        <div className='flex w-[328px] flex-col gap-3 rounded-xl bg-background-section p-6'>
          <div className='flex size-10 items-center justify-center rounded-[10px] bg-components-card-bg shadow-lg shadow-shadow-shadow-5'>
            <RiBookOpenLine className='size-5 text-text-accent' />
          </div>
          <div className='flex flex-col gap-y-2'>
            <div className='system-xl-semibold text-text-secondary'>{t('datasetCreation.stepThree.sideTipTitle')}</div>
            <div className='system-sm-regular text-text-tertiary'>{t('datasetCreation.stepThree.sideTipContent')}</div>
            <a
              href={`https://docs.dify.ai/${docLanguage}/guides/knowledge-base/integrate-knowledge-within-application`}
              target='_blank'
              rel='noreferrer noopener'
              className='system-sm-regular text-text-accent'
            >
              {t('datasetPipeline.addDocuments.stepThree.learnMore')}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Processing
