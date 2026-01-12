'use client'
import type { InitialDocumentDetail } from '@/models/pipeline'
import { RiBookOpenLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDocLink } from '@/context/i18n'
import EmbeddingProcess from './embedding-process'

type ProcessingProps = {
  batchId: string
  documents: InitialDocumentDetail[]
}

const Processing = ({
  batchId,
  documents,
}: ProcessingProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const datasetId = useDatasetDetailContextWithSelector(s => s.dataset?.id)
  const indexingType = useDatasetDetailContextWithSelector(s => s.dataset?.indexing_technique)
  const retrievalMethod = useDatasetDetailContextWithSelector(s => s.dataset?.retrieval_model_dict?.search_method)

  return (
    <div className="flex h-full w-full justify-center overflow-hidden">
      <div className="h-full w-3/5 overflow-y-auto pb-8 pt-10">
        <div className="max-w-[640px]">
          <EmbeddingProcess
            datasetId={datasetId!}
            batchId={batchId}
            documents={documents}
            indexingType={indexingType}
            retrievalMethod={retrievalMethod}
          />
        </div>
      </div>
      <div className="w-2/5 pr-8 pt-[88px]">
        <div className="flex w-[328px] flex-col gap-3 rounded-xl bg-background-section p-6">
          <div className="flex size-10 items-center justify-center rounded-[10px] bg-components-card-bg shadow-lg shadow-shadow-shadow-5">
            <RiBookOpenLine className="size-5 text-text-accent" />
          </div>
          <div className="flex flex-col gap-y-2">
            <div className="system-xl-semibold text-text-secondary">{t('stepThree.sideTipTitle', { ns: 'datasetCreation' })}</div>
            <div className="system-sm-regular text-text-tertiary">{t('stepThree.sideTipContent', { ns: 'datasetCreation' })}</div>
            <a
              href={docLink('/use-dify/knowledge/knowledge-pipeline/authorize-data-source')}
              target="_blank"
              rel="noreferrer noopener"
              className="system-sm-regular text-text-accent"
            >
              {t('addDocuments.stepThree.learnMore', { ns: 'datasetPipeline' })}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Processing
