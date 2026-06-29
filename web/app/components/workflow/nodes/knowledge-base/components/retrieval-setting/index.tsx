import type {
  HybridSearchModeEnum,
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
  WeightedScore,
} from '../../types'
import type { RerankingModelSelectorProps } from './reranking-model-selector'
import type {
  TopKFieldProps,
  VisibleScoreThresholdFieldProps,
} from './top-k-and-score-threshold'
import { FieldRoot } from '@langgenius/dify-ui/field'
import { FieldsetLegend, FieldsetRoot } from '@langgenius/dify-ui/fieldset'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import {
  memo,
} from 'react'
import { useTranslation } from '#i18n'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'
import { useDocLink } from '@/context/i18n'
import { useRetrievalSetting } from './hooks'
import { SearchMethodOption } from './search-method-option'

type RetrievalSettingProps = {
  indexMethod?: IndexMethodEnum
  readonly?: boolean
  searchMethod?: RetrievalSearchMethodEnum
  onRetrievalSearchMethodChange: (value: RetrievalSearchMethodEnum) => void
  hybridSearchMode?: HybridSearchModeEnum
  onHybridSearchModeChange: (value: HybridSearchModeEnum) => void
  rerankingModelEnabled?: boolean
  onRerankingModelEnabledChange: (value: boolean) => void
  weightedScore?: WeightedScore
  onWeightedScoreChange: (value: { value: number[] }) => void
  showMultiModalTip?: boolean
} & RerankingModelSelectorProps & {
  topK: TopKFieldProps['value']
  onTopKChange: TopKFieldProps['onChange']
  scoreThreshold: VisibleScoreThresholdFieldProps['value']
  onScoreThresholdChange: VisibleScoreThresholdFieldProps['onChange']
  isScoreThresholdEnabled?: VisibleScoreThresholdFieldProps['enabled']
  onScoreThresholdEnabledChange: VisibleScoreThresholdFieldProps['onEnabledChange']
}

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
          <div className="flex items-center body-xs-regular text-text-tertiary">
            <a target="_blank" rel="noopener noreferrer" href={docLink('/use-dify/knowledge/create-knowledge/setting-indexing-methods')} className="text-text-accent">{t('form.retrievalSetting.learnMore', { ns: 'datasetSettings' })}</a>
            &nbsp;
            {t('nodes.knowledgeBase.aboutRetrieval', { ns: 'workflow' })}
          </div>
        ),
      }}
    >
      <FieldRoot name="retrieval_search_method" className="gap-0">
        <FieldsetRoot
          render={(
            <RadioGroup<RetrievalSearchMethodEnum>
              value={searchMethod}
              onValueChange={value => onRetrievalSearchMethodChange(value)}
              disabled={readonly}
              className="flex-col items-stretch gap-1"
            />
          )}
        >
          <FieldsetLegend className="sr-only">
            {t('form.retrievalSetting.title', { ns: 'datasetSettings' })}
          </FieldsetLegend>
          {options.map(option => (
            <SearchMethodOption
              key={option.id}
              option={option}
              searchMethod={searchMethod}
              hybridSearch={{
                mode: hybridSearchMode,
                options: hybridSearchModeOptions,
                onModeChange: onHybridSearchModeChange,
                weightedScore,
                onWeightedScoreChange,
              }}
              retrievalParameters={{
                topK: {
                  value: topK,
                  onChange: onTopKChange,
                },
                scoreThreshold: {
                  value: scoreThreshold,
                  onChange: onScoreThresholdChange,
                  enabled: isScoreThresholdEnabled,
                  onEnabledChange: onScoreThresholdEnabledChange,
                },
              }}
              reranking={{
                enabled: rerankingModelEnabled,
                onEnabledChange: onRerankingModelEnabledChange,
                rerankingModel,
                onRerankingModelChange,
                showMultiModalTip,
              }}
              readonly={readonly}
            />
          ))}
        </FieldsetRoot>
      </FieldRoot>
    </Field>
  )
}

export default memo(RetrievalSetting)
