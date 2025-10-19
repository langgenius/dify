'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiBookOpenLine } from '@remixicon/react'
import EmbeddingProcess from '../embedding-process'

import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import type { FullDocumentDetail, createDocumentResponse } from '@/models/datasets'
import AppIcon from '@/app/components/base/app-icon'
import Divider from '@/app/components/base/divider'
import { useDocLink } from '@/context/i18n'

type StepThreeProps = {
  datasetId?: string
  datasetName?: string
  indexingType?: string
  retrievalMethod?: string
  creationCache?: createDocumentResponse
}

const StepThree = ({ datasetId, datasetName, indexingType, creationCache, retrievalMethod }: StepThreeProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const iconInfo = creationCache?.dataset?.icon_info || {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#FFF4ED',
    icon_url: '',
  }

  return (
    <div className='flex h-full max-h-full w-full justify-center overflow-y-auto'>
      <div className='h-full max-w-[960px] shrink-0 grow overflow-y-auto px-14 sm:px-16'>
        <div className='mx-auto max-w-[640px] pb-8 pt-10'>
          {!datasetId && (
            <>
              <div className='flex flex-col gap-y-1 pb-3'>
                <div className='title-2xl-semi-bold text-text-primary'>{t('datasetCreation.stepThree.creationTitle')}</div>
                <div className='system-sm-regular text-text-tertiary'>{t('datasetCreation.stepThree.creationContent')}</div>
              </div>
              <div className='flex items-center gap-x-4'>
                <AppIcon
                  size='xxl'
                  iconType={iconInfo.icon_type}
                  icon={iconInfo.icon}
                  background={iconInfo.icon_background}
                  imageUrl={iconInfo.icon_url}
                  className='shrink-0'
                />
                <div className='flex grow flex-col gap-y-1'>
                  <div className='system-sm-semibold flex h-6 items-center text-text-secondary'>
                    {t('datasetCreation.stepThree.label')}
                  </div>
                  <div className='system-sm-regular w-full truncate rounded-lg bg-components-input-bg-normal p-2 text-components-input-text-filled'>
                    <span className='px-1'>{datasetName || creationCache?.dataset?.name}</span>
                  </div>
                </div>
              </div>
              <Divider type='horizontal' className='my-6 bg-divider-subtle' />
            </>
          )}
          {datasetId && (
            <div className='flex flex-col gap-y-1 pb-3'>
              <div className='title-2xl-semi-bold text-text-primary'>{t('datasetCreation.stepThree.additionTitle')}</div>
              <div className='system-sm-regular text-text-tertiary'>{`${t('datasetCreation.stepThree.additionP1')} ${datasetName || creationCache?.dataset?.name} ${t('datasetCreation.stepThree.additionP2')}`}</div>
            </div>
          )}
          <EmbeddingProcess
            datasetId={datasetId || creationCache?.dataset?.id || ''}
            batchId={creationCache?.batch || ''}
            documents={creationCache?.documents as FullDocumentDetail[]}
            indexingType={creationCache?.dataset?.indexing_technique || indexingType}
            retrievalMethod={creationCache?.dataset?.retrieval_model_dict?.search_method || retrievalMethod}
          />
        </div>
      </div>
      {!isMobile && (
        <div className='shrink-0 pr-8 pt-[88px] text-xs'>
          <div className='flex w-[328px] flex-col gap-3 rounded-xl bg-background-section p-6 text-text-tertiary'>
            <div className='flex size-10 items-center justify-center rounded-[10px] bg-components-card-bg shadow-lg'>
              <RiBookOpenLine className='size-5 text-text-accent' />
            </div>
            <div className='text-base font-semibold text-text-secondary'>{t('datasetCreation.stepThree.sideTipTitle')}</div>
            <div className='text-text-tertiary'>{t('datasetCreation.stepThree.sideTipContent')}</div>
            <a
              href={docLink('/guides/knowledge-base/integrate-knowledge-within-application')}
              target='_blank'
              rel='noreferrer noopener'
              className='system-sm-regular text-text-accent'
            >
              {t('datasetPipeline.addDocuments.stepThree.learnMore')}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

export default StepThree
