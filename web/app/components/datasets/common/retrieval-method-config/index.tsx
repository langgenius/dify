'use client'
import type { RetrievalConfig } from '@/types/app'
import { useQuery } from '@tanstack/react-query'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { DEFAULT_WEIGHTED_SCORE, RerankingModeEnum, WeightedScoreEnum } from '@/models/datasets'
import { consoleQuery } from '@/service/client'
import { RETRIEVE_METHOD } from '@/types/app'
import { EffectColor } from '../../settings/chunk-structure/types'
import OptionCard from '../../settings/option-card'
import RetrievalParamConfig from '../retrieval-param-config'

type Props = Readonly<{
  disabled?: boolean
  value: RetrievalConfig
  showMultiModalTip?: boolean
  onChange: (value: RetrievalConfig) => void
}>

function RetrievalMethodConfig({
  disabled = false,
  value,
  showMultiModalTip = false,
  onChange,
}: Props) {
  const { t } = useTranslation()
  const { data: retrievalSetting } = useQuery(
    consoleQuery.datasets.retrievalSetting.get.queryOptions(),
  )
  const supportRetrievalMethods = retrievalSetting?.retrieval_method ?? []
  const { defaultModel: rerankDefaultModel, currentModel: isRerankDefaultModelValid } =
    useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const onSwitch = useCallback(
    (retrieveMethod: RETRIEVE_METHOD) => {
      if ([RETRIEVE_METHOD.semantic, RETRIEVE_METHOD.fullText].includes(retrieveMethod)) {
        onChange({
          ...value,
          search_method: retrieveMethod,
          ...(!value.reranking_model.reranking_model_name ||
          !value.reranking_model.reranking_provider_name
            ? {
                reranking_model: {
                  reranking_provider_name: isRerankDefaultModelValid
                    ? (rerankDefaultModel?.provider?.provider ?? '')
                    : '',
                  reranking_model_name: isRerankDefaultModelValid
                    ? (rerankDefaultModel?.model ?? '')
                    : '',
                },
                reranking_enable: !!isRerankDefaultModelValid,
              }
            : {
                reranking_enable: true,
              }),
        })
      }
      if (retrieveMethod === RETRIEVE_METHOD.hybrid) {
        onChange({
          ...value,
          search_method: retrieveMethod,
          ...(!value.reranking_model.reranking_model_name ||
          !value.reranking_model.reranking_provider_name
            ? {
                reranking_model: {
                  reranking_provider_name: isRerankDefaultModelValid
                    ? (rerankDefaultModel?.provider?.provider ?? '')
                    : '',
                  reranking_model_name: isRerankDefaultModelValid
                    ? (rerankDefaultModel?.model ?? '')
                    : '',
                },
                reranking_enable: !!isRerankDefaultModelValid,
                reranking_mode: isRerankDefaultModelValid
                  ? RerankingModeEnum.RerankingModel
                  : RerankingModeEnum.WeightedScore,
              }
            : {
                reranking_enable: true,
                reranking_mode: RerankingModeEnum.RerankingModel,
              }),
          ...(!value.weights
            ? {
                weights: {
                  weight_type: WeightedScoreEnum.Customized,
                  vector_setting: {
                    vector_weight: DEFAULT_WEIGHTED_SCORE.other.semantic,
                    embedding_provider_name: '',
                    embedding_model_name: '',
                  },
                  keyword_setting: {
                    keyword_weight: DEFAULT_WEIGHTED_SCORE.other.keyword,
                  },
                },
              }
            : {}),
        })
      }
    },
    [value, rerankDefaultModel, isRerankDefaultModelValid, onChange],
  )

  return (
    <div className="flex flex-col gap-y-2">
      {supportRetrievalMethods.includes('semantic_search') && (
        <OptionCard
          id={RETRIEVE_METHOD.semantic}
          disabled={disabled}
          icon={<span className="i-custom-vender-knowledge-vector-search size-4" />}
          iconActiveColor="text-util-colors-purple-purple-600"
          title={t(($) => $['retrieval.semantic_search.title'], { ns: 'dataset' })}
          description={t(($) => $['retrieval.semantic_search.description'], { ns: 'dataset' })}
          isActive={value.search_method === RETRIEVE_METHOD.semantic}
          onClick={onSwitch}
          effectColor={EffectColor.purple}
          showEffectColor
          showChildren={value.search_method === RETRIEVE_METHOD.semantic}
          className="gap-x-2"
        >
          <RetrievalParamConfig
            type={RETRIEVE_METHOD.semantic}
            value={value}
            onChange={onChange}
            showMultiModalTip={showMultiModalTip}
            disabled={disabled}
          />
        </OptionCard>
      )}
      {supportRetrievalMethods.includes('full_text_search') && (
        <OptionCard
          id={RETRIEVE_METHOD.fullText}
          disabled={disabled}
          icon={<span className="i-custom-vender-knowledge-full-text-search size-4" />}
          iconActiveColor="text-util-colors-purple-purple-600"
          title={t(($) => $['retrieval.full_text_search.title'], { ns: 'dataset' })}
          description={t(($) => $['retrieval.full_text_search.description'], { ns: 'dataset' })}
          isActive={value.search_method === RETRIEVE_METHOD.fullText}
          onClick={onSwitch}
          effectColor={EffectColor.purple}
          showEffectColor
          showChildren={value.search_method === RETRIEVE_METHOD.fullText}
          className="gap-x-2"
        >
          <RetrievalParamConfig
            type={RETRIEVE_METHOD.fullText}
            value={value}
            onChange={onChange}
            showMultiModalTip={showMultiModalTip}
            disabled={disabled}
          />
        </OptionCard>
      )}
      {supportRetrievalMethods.includes('hybrid_search') && (
        <OptionCard
          id={RETRIEVE_METHOD.hybrid}
          disabled={disabled}
          icon={<span className="i-custom-vender-knowledge-hybrid-search size-4" />}
          iconActiveColor="text-util-colors-purple-purple-600"
          title={t(($) => $['retrieval.hybrid_search.title'], { ns: 'dataset' })}
          description={t(($) => $['retrieval.hybrid_search.description'], { ns: 'dataset' })}
          isActive={value.search_method === RETRIEVE_METHOD.hybrid}
          onClick={onSwitch}
          effectColor={EffectColor.purple}
          showEffectColor
          isRecommended
          showChildren={value.search_method === RETRIEVE_METHOD.hybrid}
          className="gap-x-2"
        >
          <RetrievalParamConfig
            type={RETRIEVE_METHOD.hybrid}
            value={value}
            onChange={onChange}
            showMultiModalTip={showMultiModalTip}
            disabled={disabled}
          />
        </OptionCard>
      )}
    </div>
  )
}
export default memo(RetrievalMethodConfig)
