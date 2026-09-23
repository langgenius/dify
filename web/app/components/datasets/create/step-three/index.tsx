'use client'
import type { createDocumentResponse, FullDocumentDetail } from '@/models/datasets'
import type { RETRIEVE_METHOD } from '@/types/app'
import { Separator } from '@langgenius/dify-ui/separator'
import { RiBookOpenLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { useDocLink } from '@/context/i18n'
import EmbeddingProcess from '../embedding-process'

type StepThreeProps = {
  datasetId?: string
  datasetName?: string
  indexingType?: string
  retrievalMethod?: RETRIEVE_METHOD
  creationCache?: createDocumentResponse
}

const StepThree = ({
  datasetId,
  datasetName,
  indexingType,
  creationCache,
  retrievalMethod,
}: StepThreeProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()

  const iconInfo = creationCache?.dataset?.icon_info || {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#FFF4ED',
    icon_url: '',
  }

  return (
    <div className="flex size-full max-h-full min-w-0 flex-col overflow-y-auto xl:flex-row xl:justify-center">
      <div className="max-w-240 min-w-0 shrink-0 grow px-4 sm:px-8 xl:shrink xl:px-16">
        <div className="mx-auto max-w-160 pt-10 pb-8">
          {!datasetId && (
            <>
              <div className="flex flex-col gap-y-1 pb-3">
                <h1 className="title-2xl-semi-bold text-text-primary">
                  {t(($) => $['stepThree.creationTitle'], { ns: 'datasetCreation' })}
                </h1>
                <div className="system-sm-regular text-text-tertiary">
                  {t(($) => $['stepThree.creationContent'], { ns: 'datasetCreation' })}
                </div>
              </div>
              <div className="flex items-center gap-x-4">
                <AppIcon
                  size="xxl"
                  iconType={iconInfo.icon_type}
                  icon={iconInfo.icon}
                  background={iconInfo.icon_background}
                  imageUrl={iconInfo.icon_url}
                  className="shrink-0"
                />
                <div className="flex min-w-0 grow flex-col gap-y-1">
                  <div className="flex h-6 items-center system-sm-semibold text-text-secondary">
                    {t(($) => $['stepThree.label'], { ns: 'datasetCreation' })}
                  </div>
                  <div className="w-full rounded-lg bg-components-input-bg-normal p-2 system-sm-regular wrap-anywhere text-components-input-text-filled">
                    <span className="px-1">{datasetName || creationCache?.dataset?.name}</span>
                  </div>
                </div>
              </div>
              <Separator orientation="horizontal" className="my-6 h-[0.5px] bg-divider-subtle" />
            </>
          )}
          {datasetId && (
            <div className="flex flex-col gap-y-1 pb-3">
              <h1 className="title-2xl-semi-bold text-text-primary">
                {t(($) => $['stepThree.additionTitle'], { ns: 'datasetCreation' })}
              </h1>
              <div className="system-sm-regular text-text-tertiary">{`${t(($) => $['stepThree.additionP1'], { ns: 'datasetCreation' })} ${datasetName || creationCache?.dataset?.name} ${t(($) => $['stepThree.additionP2'], { ns: 'datasetCreation' })}`}</div>
            </div>
          )}
          <EmbeddingProcess
            datasetId={datasetId || creationCache?.dataset?.id || ''}
            batchId={creationCache?.batch || ''}
            documents={creationCache?.documents as FullDocumentDetail[]}
            indexingType={creationCache?.dataset?.indexing_technique || indexingType}
            retrievalMethod={
              creationCache?.dataset?.retrieval_model_dict?.search_method || retrievalMethod
            }
          />
        </div>
      </div>
      <div className="shrink-0 px-4 pb-8 text-xs sm:px-8 xl:pt-22 xl:pl-0">
        <div className="flex w-full max-w-82 flex-col gap-3 rounded-xl bg-background-section p-6 text-text-tertiary">
          <div className="flex size-10 items-center justify-center rounded-[10px] bg-components-card-bg shadow-lg">
            <RiBookOpenLine className="size-5 text-text-accent" />
          </div>
          <h2 className="text-base font-semibold text-text-secondary">
            {t(($) => $['stepThree.sideTipTitle'], { ns: 'datasetCreation' })}
          </h2>
          <div className="text-text-tertiary">
            {t(($) => $['stepThree.sideTipContent'], { ns: 'datasetCreation' })}
          </div>
          <a
            href={docLink('/use-dify/knowledge/integrate-knowledge-within-application')}
            target="_blank"
            rel="noreferrer noopener"
            className="system-sm-regular text-text-accent"
          >
            {t(($) => $['addDocuments.stepThree.learnMore'], { ns: 'datasetPipeline' })}
          </a>
        </div>
      </div>
    </div>
  )
}

export default StepThree
