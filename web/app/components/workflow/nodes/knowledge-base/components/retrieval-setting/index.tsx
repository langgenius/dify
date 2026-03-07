import type {
  HybridSearchModeEnum,
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
  WeightedScore,
} from '../../types'
import type { RerankingModelSelectorProps } from './reranking-model-selector'
import type { TopKAndScoreThresholdProps } from './top-k-and-score-threshold'
import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import { useDocLink } from '@/context/i18n'
import { useRetrievalSetting } from './hooks'
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
  showMultiModalTip?: boolean
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
  showMultiModalTip,
}: RetrievalSettingProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const {
    options,
    hybridSearchModeOptions,
  } = useRetrievalSetting(indexMethod)

  return (
    <Field
      fieldTitleProps={{
        title: t('form.retrievalSetting.title', { ns: 'datasetSettings' }),
        subTitle: (
          <div className="body-xs-regular flex items-center text-text-tertiary">
            <a target="_blank" rel="noopener noreferrer" href={docLink('/use-dify/knowledge/create-knowledge/setting-indexing-methods')} className="text-text-accent">{t('form.retrievalSetting.learnMore', { ns: 'datasetSettings' })}</a>
            &nbsp;
            {t('nodes.knowledgeBase.aboutRetrieval', { ns: 'workflow' })}
          </div>
        ),
      }}
    >
      <div className="space-y-1">
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
              showMultiModalTip={showMultiModalTip}
            />
          ))
        }
      </div>
    </Field>
  )
}

export default memo(RetrievalSetting)
