'use client'

import type {
  DefaultModel,
  Model,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useMultimodalRetrievalGuidanceDismissedValue,
  useSetMultimodalRetrievalGuidanceDismissed,
} from './storage'
import { TipCard } from './tip-card'

type MultimodalRetrievalGuidanceVariant = 'create' | 'settings' | 'pipeline'

type MultimodalRetrievalGuidanceProps = {
  variant: MultimodalRetrievalGuidanceVariant
  embeddingModel?: DefaultModel
  embeddingModelList?: Model[]
  className?: string
}

const MULTIMODAL_RETRIEVAL_DOC_URL =
  'https://dify.ai/blog/multimodal-retrieval-is-now-available-in-the-knowledge-base'

const isVisionEmbeddingModel = (embeddingModel?: DefaultModel, embeddingModelList?: Model[]) => {
  if (!embeddingModel?.provider || !embeddingModel.model) return false

  const provider = embeddingModelList?.find((item) => item.provider === embeddingModel.provider)
  const model = provider?.models?.find((item) => item.model === embeddingModel.model)

  return !!model?.features?.includes(ModelFeatureEnum.vision)
}

const useVariantCopy = (variant: MultimodalRetrievalGuidanceVariant) => {
  const { t } = useTranslation()

  if (variant === 'create') {
    return {
      title: t(($) => $['form.multimodalRetrievalGuidance.createTitle'], {
        ns: 'datasetSettings',
      }),
      description: t(($) => $['form.multimodalRetrievalGuidance.createDescription'], {
        ns: 'datasetSettings',
      }),
    }
  }

  if (variant === 'settings') {
    return {
      title: t(($) => $['form.multimodalRetrievalGuidance.settingsTitle'], {
        ns: 'datasetSettings',
      }),
      description: t(($) => $['form.multimodalRetrievalGuidance.settingsDescription'], {
        ns: 'datasetSettings',
      }),
    }
  }

  return {
    title: t(($) => $['form.multimodalRetrievalGuidance.pipelineTitle'], {
      ns: 'datasetSettings',
    }),
    description: t(($) => $['form.multimodalRetrievalGuidance.pipelineDescription'], {
      ns: 'datasetSettings',
    }),
  }
}

export const MultimodalRetrievalGuidanceLearnMore = ({ className }: { className?: string }) => {
  const { t } = useTranslation()

  return (
    <div className={cn('flex items-center body-xs-regular text-text-tertiary', className)}>
      <a
        target="_blank"
        rel="noopener noreferrer"
        href={MULTIMODAL_RETRIEVAL_DOC_URL}
        className="text-text-accent"
      >
        {t(($) => $['form.multimodalRetrievalGuidance.helpLink'], {
          ns: 'datasetSettings',
        })}
      </a>
      &nbsp;
      {t(($) => $['form.multimodalRetrievalGuidance.helpDescription'], {
        ns: 'datasetSettings',
      })}
    </div>
  )
}

export const MultimodalRetrievalGuidance = ({
  variant,
  embeddingModel,
  embeddingModelList,
  className,
}: MultimodalRetrievalGuidanceProps) => {
  const { t } = useTranslation()
  const { title, description } = useVariantCopy(variant)
  const dismissLabel = t(($) => $['form.multimodalRetrievalGuidance.dismiss'], {
    ns: 'datasetSettings',
  })
  const dismissed = useMultimodalRetrievalGuidanceDismissedValue()
  const setDismissed = useSetMultimodalRetrievalGuidanceDismissed()

  if (dismissed || isVisionEmbeddingModel(embeddingModel, embeddingModelList)) return null

  return (
    <div className={cn('relative', className)}>
      <TipCard
        title={title}
        description={description}
        dismissLabel={dismissLabel}
        onDismiss={() => setDismissed(true)}
      />
    </div>
  )
}
