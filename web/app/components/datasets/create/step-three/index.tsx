'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiBookOpenLine } from '@remixicon/react'
import EmbeddingProcess from '../embedding-process'

import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import type { FullDocumentDetail, createDocumentResponse } from '@/models/datasets'
import AppIcon from '@/app/components/base/app-icon'

type StepThreeProps = {
  datasetId?: string
  datasetName?: string
  indexingType?: string
  retrievalMethod?: string
  creationCache?: createDocumentResponse
}

const StepThree = ({ datasetId, datasetName, indexingType, creationCache, retrievalMethod }: StepThreeProps) => {
  const { t } = useTranslation()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  return (
    <div className="flex justify-center w-full max-h-full h-full overflow-y-auto">
      <div className="grow shrink-0 h-full max-w-[960px] overflow-y-auto px-14 sm:px-16">
        <div className="mx-auto max-w-[640px]">
          {!datasetId && (
            <>
              <div className="pt-10">
                <div className="mb-1 text-xl leading-[22px] font-semibold text-text-primary">{t('datasetCreation.stepThree.creationTitle')}</div>
                <div className="mb-7 text-[13px] leading-4 text-text-tertiary">{t('datasetCreation.stepThree.creationContent')}</div>
                <div className="flex gap-4">
                  <AppIcon {...creationCache?.dataset} className="size-14 text-2xl self-center" />
                  <div className="grow flex flex-col gap-1">
                    <div className="text-[13px] leading-6 font-semibold">{t('datasetCreation.stepThree.label')}</div>
                    <div className="w-full px-3 py-2 text-[13px] leading-4 bg-components-input-bg-normal rounded-lg truncate">{datasetName || creationCache?.dataset?.name}</div>
                  </div>
                </div>
              </div>
              <hr className="my-6 h-[1px] bg-divider-subtle border-0" />
            </>
          )}
          {datasetId && (
            <div className="pt-10">
              <div className="mb-1 text-xl leading-[22px] font-semibold text-text-primary">{t('datasetCreation.stepThree.additionTitle')}</div>
              <div className="mb-7 text-[13px] leading-4 text-text-tertiary">{`${t('datasetCreation.stepThree.additionP1')} ${datasetName || creationCache?.dataset?.name} ${t('datasetCreation.stepThree.additionP2')}`}</div>
            </div>
          )}
          <EmbeddingProcess
            datasetId={datasetId || creationCache?.dataset?.id || ''}
            batchId={creationCache?.batch || ''}
            documents={creationCache?.documents as FullDocumentDetail[]}
            indexingType={indexingType || creationCache?.dataset?.indexing_technique}
            retrievalMethod={retrievalMethod || creationCache?.dataset?.retrieval_model?.search_method}
          />
        </div>
      </div>
      {!isMobile && (
        <div className="shrink-0 pt-[88px] pr-8 text-xs">
          <div className="flex flex-col gap-3 w-[328px] p-6 text-text-tertiary bg-background-section rounded-xl">
            <div className="flex justify-center items-center size-10 bg-components-card-bg rounded-[10px] shadow-lg">
              <RiBookOpenLine className="size-5 text-text-accent" />
            </div>
            <div className="text-base font-semibold text-text-secondary">{t('datasetCreation.stepThree.sideTipTitle')}</div>
            <div className="text-text-tertiary">{t('datasetCreation.stepThree.sideTipContent')}</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default StepThree
