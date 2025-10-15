import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import type {
  HybridSearchModeEnum,
  RetrievalSearchMethodEnum,
} from '../../types'
import type {
  IndexMethodEnum,
  WeightedScore,
} from '../../types'
import { useRetrievalSetting } from './hooks'
import type { TopKAndScoreThresholdProps } from './top-k-and-score-threshold'
import type { RerankingModelSelectorProps } from './reranking-model-selector'
import SearchMethodOption from './search-method-option'

type RetrievalSettingProps = {
  indexMethod?: IndexMethodEnum
  readonly?: boolean
  searchMethod?: RetrievalSearchMethodEnum
  onRetrievalSearchMethodChange: (value: RetrievalSearchMethodEnum) => void
  hybridSearchMode?: HybridSearchModeEnum
  onHybridSearchModeChange: (value: HybridSearchModeEnum) => void
  rerankingModelEnabled?: boolean
  onRerankingModelEnabledChange?: (value: boolean) => void
  weightedScore?: WeightedScore
  onWeightedScoreChange: (value: { value: number[] }) => void
} & RerankingModelSelectorProps & TopKAndScoreThresholdProps

const RetrievalSetting = ({
  indexMethod,
  readonly,
  searchMethod,
  onRetrievalSearchMethodChange,
  hybridSearchMode,
  onHybridSearchModeChange,
  weightedScore,
  onWeightedScoreChange,
  rerankingModelEnabled,
  onRerankingModelEnabledChange,
  rerankingModel,
  onRerankingModelChange,
  topK,
  onTopKChange,
  scoreThreshold,
  onScoreThresholdChange,
  isScoreThresholdEnabled,
  onScoreThresholdEnabledChange,
}: RetrievalSettingProps) => {
  const { t } = useTranslation()
  const {
    options,
    hybridSearchModeOptions,
  } = useRetrievalSetting(indexMethod)

  return (
    <Field
      fieldTitleProps={{
        title: t('datasetSettings.form.retrievalSetting.title'),
        subTitle: (
          <div className='body-xs-regular flex items-center text-text-tertiary'>
            <a target='_blank' rel='noopener noreferrer' href='https://docs.dify.ai/guides/knowledge-base/create-knowledge-and-upload-documents#id-4-retrieval-settings' className='text-text-accent'>{t('datasetSettings.form.retrievalSetting.learnMore')}</a>
            &nbsp;{t('workflow.nodes.knowledgeBase.aboutRetrieval')}
          </div>
        ),
      }}
    >
      <div className='space-y-1'>
        {
          options.map(option => (
            <SearchMethodOption
              key={option.id}
              option={option}
              hybridSearchModeOptions={hybridSearchModeOptions}
              searchMethod={searchMethod}
              onRetrievalSearchMethodChange={onRetrievalSearchMethodChange}
              hybridSearchMode={hybridSearchMode}
              onHybridSearchModeChange={onHybridSearchModeChange}
              weightedScore={weightedScore}
              onWeightedScoreChange={onWeightedScoreChange}
              topK={topK}
              onTopKChange={onTopKChange}
              scoreThreshold={scoreThreshold}
              onScoreThresholdChange={onScoreThresholdChange}
              isScoreThresholdEnabled={isScoreThresholdEnabled}
              onScoreThresholdEnabledChange={onScoreThresholdEnabledChange}
              rerankingModelEnabled={rerankingModelEnabled}
              onRerankingModelEnabledChange={onRerankingModelEnabledChange}
              rerankingModel={rerankingModel}
              onRerankingModelChange={onRerankingModelChange}
              readonly={readonly}
            />
          ))
        }
      </div>
    </Field>
  )
}

export default memo(RetrievalSetting)
