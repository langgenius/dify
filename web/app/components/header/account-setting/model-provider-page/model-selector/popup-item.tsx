import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from '../declarations'
import {
  useLanguage,
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import {
  ConfigurateMethodEnum,
  MODEL_STATUS_TEXT,
  ModelStatusEnum,
} from '../declarations'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import Tooltip from '@/app/components/base/tooltip'

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
        currentConfigurateMethod: ConfigurateMethodEnum.predefinedModel,
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
    <div className='mb-1'>
      <div className='flex items-center px-3 h-[22px] text-xs font-medium text-gray-500'>
        {model.label[language] || model.label.en_US}
      </div>
      {
        model.models.map(modelItem => (
          <Tooltip
            selector={`${modelItem.model}-${modelItem.status}`}
            key={modelItem.model}
            content={modelItem.status !== ModelStatusEnum.active ? MODEL_STATUS_TEXT[modelItem.status][language] : undefined}
            position='right'
          >
            <div
              key={modelItem.model}
              className={`
                group relative flex items-center px-3 py-1.5 h-8 rounded-lg
                ${modelItem.status === ModelStatusEnum.active ? 'cursor-pointer hover:bg-gray-50' : 'cursor-not-allowed hover:bg-gray-50/60'}
              `}
              onClick={() => handleSelect(model.provider, modelItem)}
            >
              <ModelIcon
                className={`
                  shrink-0 mr-2 w-4 h-4
                  ${modelItem.status !== ModelStatusEnum.active && 'opacity-60'}
                `}
                provider={model}
                modelName={modelItem.model}
              />
              <ModelName
                className={`
                  grow text-sm font-normal text-gray-900
                  ${modelItem.status !== ModelStatusEnum.active && 'opacity-60'}
                `}
                modelItem={modelItem}
                showMode
                showFeatures
              />
              {
                defaultModel?.model === modelItem.model && defaultModel.provider === currentProvider.provider && (
                  <Check className='shrink-0 w-4 h-4 text-primary-600' />
                )
              }
              {
                modelItem.status === ModelStatusEnum.noConfigure && (
                  <div
                    className='hidden group-hover:block text-xs font-medium text-primary-600 cursor-pointer'
                    onClick={handleOpenModelModal}
                  >
                    {t('common.operation.add').toLocaleUpperCase()}
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
