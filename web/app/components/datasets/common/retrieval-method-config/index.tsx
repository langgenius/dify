'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Image from 'next/image'
import RetrievalParamConfig from '../retrieval-param-config'
import { OptionCard } from '../../create/step-two/option-card'
import Effect from '../../create/assets/option-card-effect-purple.svg'
import { retrievalIcon } from '../../create/icons'
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
import Badge from '@/app/components/base/badge'

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
        ...(!value.reranking_model.reranking_model_name
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
        ...(!value.reranking_model.reranking_model_name
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
    <div className='space-y-2'>
      {supportRetrievalMethods.includes(RETRIEVE_METHOD.semantic) && (
        <OptionCard disabled={disabled} icon={<Image className='h-4 w-4' src={retrievalIcon.vector} alt='' />}
          title={t('dataset.retrieval.semantic_search.title')}
          description={t('dataset.retrieval.semantic_search.description')}
          isActive={
            value.search_method === RETRIEVE_METHOD.semantic
          }
          onSwitched={() => onSwitch(RETRIEVE_METHOD.semantic)}
          effectImg={Effect.src}
          activeHeaderClassName='bg-dataset-option-card-purple-gradient'
        >
          <RetrievalParamConfig
            type={RETRIEVE_METHOD.semantic}
            value={value}
            onChange={onChange}
          />
        </OptionCard>
      )}
      {supportRetrievalMethods.includes(RETRIEVE_METHOD.fullText) && (
        <OptionCard disabled={disabled} icon={<Image className='h-4 w-4' src={retrievalIcon.fullText} alt='' />}
          title={t('dataset.retrieval.full_text_search.title')}
          description={t('dataset.retrieval.full_text_search.description')}
          isActive={
            value.search_method === RETRIEVE_METHOD.fullText
          }
          onSwitched={() => onSwitch(RETRIEVE_METHOD.fullText)}
          effectImg={Effect.src}
          activeHeaderClassName='bg-dataset-option-card-purple-gradient'
        >
          <RetrievalParamConfig
            type={RETRIEVE_METHOD.fullText}
            value={value}
            onChange={onChange}
          />
        </OptionCard>
      )}
      {supportRetrievalMethods.includes(RETRIEVE_METHOD.hybrid) && (
        <OptionCard disabled={disabled} icon={<Image className='h-4 w-4' src={retrievalIcon.hybrid} alt='' />}
          title={
            <div className='flex items-center space-x-1'>
              <div>{t('dataset.retrieval.hybrid_search.title')}</div>
              <Badge text={t('dataset.retrieval.hybrid_search.recommend')!} className='border-text-accent-secondary text-text-accent-secondary ml-1 h-[18px]' uppercase />
            </div>
          }
          description={t('dataset.retrieval.hybrid_search.description')} isActive={
            value.search_method === RETRIEVE_METHOD.hybrid
          }
          onSwitched={() => onSwitch(RETRIEVE_METHOD.hybrid)}
          effectImg={Effect.src}
          activeHeaderClassName='bg-dataset-option-card-purple-gradient'
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
