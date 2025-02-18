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
    <div className="flex h-full max-h-full w-full justify-center overflow-y-auto">
      <div className="h-full max-w-[960px] shrink-0 grow overflow-y-auto px-14 sm:px-16">
        <div className="mx-auto max-w-[640px]">
          {!datasetId && (
            <>
              <div className="pt-10">
                <div className="text-text-primary mb-1 text-xl font-semibold leading-[22px]">{t('datasetCreation.stepThree.creationTitle')}</div>
                <div className="text-text-tertiary mb-7 text-[13px] leading-4">{t('datasetCreation.stepThree.creationContent')}</div>
                <div className="flex gap-4">
                  <AppIcon {...creationCache?.dataset} className="size-14 self-center text-2xl" />
                  <div className="flex grow flex-col gap-1">
                    <div className="text-[13px] font-semibold leading-6">{t('datasetCreation.stepThree.label')}</div>
                    <div className="bg-components-input-bg-normal w-full truncate rounded-lg px-3 py-2 text-[13px] leading-4">{datasetName || creationCache?.dataset?.name}</div>
                  </div>
                </div>
              </div>
              <hr className="bg-divider-subtle my-6 h-[1px] border-0" />
            </>
          )}
          {datasetId && (
            <div className="pt-10">
              <div className="text-text-primary mb-1 text-xl font-semibold leading-[22px]">{t('datasetCreation.stepThree.additionTitle')}</div>
              <div className="text-text-tertiary mb-7 text-[13px] leading-4">{`${t('datasetCreation.stepThree.additionP1')} ${datasetName || creationCache?.dataset?.name} ${t('datasetCreation.stepThree.additionP2')}`}</div>
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
        <div className="shrink-0 pr-8 pt-[88px] text-xs">
          <div className="text-text-tertiary bg-background-section flex w-[328px] flex-col gap-3 rounded-xl p-6">
            <div className="bg-components-card-bg flex size-10 items-center justify-center rounded-[10px] shadow-lg">
              <RiBookOpenLine className="text-text-accent size-5" />
            </div>
            <div className="text-text-secondary text-base font-semibold">{t('datasetCreation.stepThree.sideTipTitle')}</div>
            <div className="text-text-tertiary">{t('datasetCreation.stepThree.sideTipContent')}</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default StepThree
