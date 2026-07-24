import type { FC } from 'react'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from '../declarations'

import { useTranslation } from 'react-i18next'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import Tooltip from '@/app/components/base/tooltip'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import {
  useLanguage,
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'
import ModelBadge from '../model-badge'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import {
  modelTypeFormat,
  sizeFormat,
} from '../utils'
import FeatureIcon from './feature-icon'

type PopupItemProps = {
  defaultModel?: DefaultModel
  model: Model
  onSelect: (provider: string, model: ModelItem) => void
}
const PopupItem: FC<PopupItemProps> = ({
  defaultModel,
  model,
  onSelect,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const { setShowModelModal } = useModalContext()
  const { modelProviders } = useProviderContext()
  const updateModelList = useUpdateModelList()
  const updateModelProviders = useUpdateModelProviders()
  const currentProvider = modelProviders.find(provider => provider.provider === model.provider)!
  const handleSelect = (provider: string, modelItem: ModelItem) => {
    if (modelItem.status !== ModelStatusEnum.active)
      return

    onSelect(provider, modelItem)
  }
  const handleOpenModelModal = () => {
    setShowModelModal({
      payload: {
        currentProvider,
        currentConfigurationMethod: ConfigurationMethodEnum.predefinedModel,
      },
      onSaveCallback: () => {
        updateModelProviders()

        const modelType = model.models[0].model_type

        if (modelType)
          updateModelList(modelType)
      },
    })
  }

  return (
    <div className="mb-1">
      <div className="flex h-[22px] items-center px-3 text-xs font-medium text-text-tertiary">
        {model.label[language] || model.label.en_US}
      </div>
      {
        model.models.map(modelItem => (
          <Tooltip
            key={modelItem.model}
            position="right"
            popupClassName="p-3 !w-[206px] bg-components-panel-bg-blur backdrop-blur-sm border-[0.5px] border-components-panel-border rounded-xl"
            popupContent={(
              <div className="flex flex-col gap-1">
                <div className="flex flex-col items-start gap-2">
                  <ModelIcon
                    className={cn('h-5 w-5 shrink-0')}
                    provider={model}
                    modelName={modelItem.model}
                  />
                  <div className="system-md-medium text-wrap break-words text-text-primary">{modelItem.label[language] || modelItem.label.en_US}</div>
                </div>
                {/* {currentProvider?.description && (
                  <div className='text-text-tertiary system-xs-regular'>{currentProvider?.description?.[language] || currentProvider?.description?.en_US}</div>
                )} */}
                <div className="flex flex-wrap gap-1">
                  {!!modelItem.model_type && (
                    <ModelBadge>
                      {modelTypeFormat(modelItem.model_type)}
                    </ModelBadge>
                  )}
                  {!!modelItem.model_properties.mode && (
                    <ModelBadge>
                      {(modelItem.model_properties.mode as string).toLocaleUpperCase()}
                    </ModelBadge>
                  )}
                  {!!modelItem.model_properties.context_size && (
                    <ModelBadge>
                      {sizeFormat(modelItem.model_properties.context_size as number)}
                    </ModelBadge>
                  )}
                </div>
                {[ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding, ModelTypeEnum.rerank].includes(modelItem.model_type as ModelTypeEnum)
                  && modelItem.features?.some(feature => [ModelFeatureEnum.vision, ModelFeatureEnum.audio, ModelFeatureEnum.video, ModelFeatureEnum.document].includes(feature))
                  && (
                    <div className="pt-2">
                      <div className="system-2xs-medium-uppercase mb-1 text-text-tertiary">{t('model.capabilities', { ns: 'common' })}</div>
                      <div className="flex flex-wrap gap-1">
                        {modelItem.features?.map(feature => (
                          <FeatureIcon
                            key={feature}
                            feature={feature}
                            showFeaturesLabel
                          />
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}
          >
            <div
              key={modelItem.model}
              className={cn('group relative flex h-8 items-center gap-1 rounded-lg px-3 py-1.5', modelItem.status === ModelStatusEnum.active ? 'cursor-pointer hover:bg-state-base-hover' : 'cursor-not-allowed hover:bg-state-base-hover-alt')}
              onClick={() => handleSelect(model.provider, modelItem)}
            >
              <div className="flex items-center gap-2">
                <ModelIcon
                  className={cn('h-5 w-5 shrink-0')}
                  provider={model}
                  modelName={modelItem.model}
                />
                <ModelName
                  className={cn('system-sm-medium text-text-secondary', modelItem.status !== ModelStatusEnum.active && 'opacity-60')}
                  modelItem={modelItem}
                />
              </div>
              {
                defaultModel?.model === modelItem.model && defaultModel.provider === currentProvider.provider && (
                  <Check className="h-4 w-4 shrink-0 text-text-accent" />
                )
              }
              {
                modelItem.status === ModelStatusEnum.noConfigure && (
                  <div
                    className="hidden cursor-pointer text-xs font-medium text-text-accent group-hover:block"
                    onClick={handleOpenModelModal}
                  >
                    {t('operation.add', { ns: 'common' }).toLocaleUpperCase()}
                  </div>
                )
              }
            </div>
          </Tooltip>
        ))
      }
    </div>
  )
}

export default PopupItem
