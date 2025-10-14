'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import RetrievalParamConfig from '../retrieval-param-config'
import type { RetrievalConfig } from '@/types/app'
import { RETRIEVE_METHOD } from '@/types/app'
import { useProviderContext } from '@/context/provider-context'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  DEFAULT_WEIGHTED_SCORE,
  RerankingModeEnum,
  WeightedScoreEnum,
} from '@/models/datasets'
import OptionCard from '../../settings/option-card'
import { FullTextSearch, HybridSearch, VectorSearch } from '@/app/components/base/icons/src/vender/knowledge'
import { EffectColor } from '../../settings/chunk-structure/types'

type Props = {
  disabled?: boolean
  value: RetrievalConfig
  onChange: (value: RetrievalConfig) => void
}

const RetrievalMethodConfig: FC<Props> = ({
  disabled = false,
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const { supportRetrievalMethods } = useProviderContext()
  const {
    defaultModel: rerankDefaultModel,
    currentModel: isRerankDefaultModelValid,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const onSwitch = useCallback((retrieveMethod: RETRIEVE_METHOD) => {
    if ([RETRIEVE_METHOD.semantic, RETRIEVE_METHOD.fullText].includes(retrieveMethod)) {
      onChange({
        ...value,
        search_method: retrieveMethod,
        ...((!value.reranking_model.reranking_model_name || !value.reranking_model.reranking_provider_name)
          ? {
            reranking_model: {
              reranking_provider_name: isRerankDefaultModelValid ? rerankDefaultModel?.provider?.provider ?? '' : '',
              reranking_model_name: isRerankDefaultModelValid ? rerankDefaultModel?.model ?? '' : '',
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
        ...((!value.reranking_model.reranking_model_name || !value.reranking_model.reranking_provider_name)
          ? {
            reranking_model: {
              reranking_provider_name: isRerankDefaultModelValid ? rerankDefaultModel?.provider?.provider ?? '' : '',
              reranking_model_name: isRerankDefaultModelValid ? rerankDefaultModel?.model ?? '' : '',
            },
            reranking_enable: !!isRerankDefaultModelValid,
            reranking_mode: isRerankDefaultModelValid ? RerankingModeEnum.RerankingModel : RerankingModeEnum.WeightedScore,
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
  }, [value, rerankDefaultModel, isRerankDefaultModelValid, onChange])

  return (
    <div className='flex flex-col gap-y-2'>
      {supportRetrievalMethods.includes(RETRIEVE_METHOD.semantic) && (
        <OptionCard
          id={RETRIEVE_METHOD.semantic}
          disabled={disabled}
          icon={<VectorSearch className='size-4' />}
          iconActiveColor='text-util-colors-purple-purple-600'
          title={t('dataset.retrieval.semantic_search.title')}
          description={t('dataset.retrieval.semantic_search.description')}
          isActive={value.search_method === RETRIEVE_METHOD.semantic}
          onClick={onSwitch}
          effectColor={EffectColor.purple}
          showEffectColor
          showChildren={value.search_method === RETRIEVE_METHOD.semantic}
          className='gap-x-2'
        >
          <RetrievalParamConfig
            type={RETRIEVE_METHOD.semantic}
            value={value}
            onChange={onChange}
          />
        </OptionCard>
      )}
      {supportRetrievalMethods.includes(RETRIEVE_METHOD.fullText) && (
        <OptionCard
          id={RETRIEVE_METHOD.fullText}
          disabled={disabled}
          icon={<FullTextSearch className='size-4' />}
          iconActiveColor='text-util-colors-purple-purple-600'
          title={t('dataset.retrieval.full_text_search.title')}
          description={t('dataset.retrieval.full_text_search.description')}
          isActive={value.search_method === RETRIEVE_METHOD.fullText}
          onClick={onSwitch}
          effectColor={EffectColor.purple}
          showEffectColor
          showChildren={value.search_method === RETRIEVE_METHOD.fullText}
          className='gap-x-2'
        >
          <RetrievalParamConfig
            type={RETRIEVE_METHOD.fullText}
            value={value}
            onChange={onChange}
          />
        </OptionCard>
      )}
      {supportRetrievalMethods.includes(RETRIEVE_METHOD.hybrid) && (
        <OptionCard
          id={RETRIEVE_METHOD.hybrid}
          disabled={disabled}
          icon={<HybridSearch className='size-4' />}
          iconActiveColor='text-util-colors-purple-purple-600'
          title={t('dataset.retrieval.hybrid_search.title')}
          description={t('dataset.retrieval.hybrid_search.description')}
          isActive={value.search_method === RETRIEVE_METHOD.hybrid}
          onClick={onSwitch}
          effectColor={EffectColor.purple}
          showEffectColor
          isRecommended
          showChildren={value.search_method === RETRIEVE_METHOD.hybrid}
          className='gap-x-2'
        >
          <RetrievalParamConfig
            type={RETRIEVE_METHOD.hybrid}
            value={value}
            onChange={onChange}
          />
        </OptionCard>
      )}
    </div>
  )
}
export default React.memo(RetrievalMethodConfig)
