import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import type {
  Model,
  ModelItem,
} from '../declarations'
import ModelBadge from '../model-badge'
import { ModelStatusEnum } from '../declarations'
import { languageMaps } from '../utils'
import FeatureIcon from './feature-icon'
import I18n from '@/context/i18n'
import { Check } from '@/app/components/base/icons/src/vender/line/general'

type PopupItemProps = {
  defaultModel?: ModelItem
  model: Model
  onSelect: (model: ModelItem) => void
}
const PopupItem: FC<PopupItemProps> = ({
  defaultModel,
  model,
  onSelect,
}) => {
  const { locale } = useContext(I18n)
  const language = languageMaps[locale]

  const handleSelect = (modelItem: ModelItem) => {
    if (modelItem.status !== ModelStatusEnum.active)
      return

    onSelect(modelItem)
  }

  return (
    <div className='mb-1'>
      <div className='flex items-center px-3 h-[22px] text-xs font-medium text-gray-500'>
        {model.label[language]}
      </div>
      {
        model.models.map(modelItem => (
          <div
            key={modelItem.model}
            className={`
              group flex items-center px-3 py-1.5 h-8 rounded-lg
              ${modelItem.status === ModelStatusEnum.active ? 'cursor-pointer hover:bg-gray-50' : 'cursor-not-allowed hover:bg-gray-50/60'}
            `}
            onClick={() => handleSelect(modelItem)}
          >
            <div
              className={`
                shrink-0 mr-2 w-4 h-4
                ${modelItem.status !== ModelStatusEnum.active && 'opacity-60'}
              `}
            ></div>
            <div
              className={`
                shrink-0 mr-2 text-sm text-gray-900 truncate
                ${modelItem.status !== ModelStatusEnum.active && 'opacity-60'}
              `}
              title={modelItem.label[language]}
            >
              {modelItem.label[language]}
            </div>
            <div
              className={`
                hidden shrink-0 group-hover:flex items-center
                ${modelItem.status !== ModelStatusEnum.active && 'opacity-60'}
              `}
            >
              {
                modelItem.model_properties.mode && (
                  <ModelBadge className='mr-0.5'>
                    {(modelItem.model_properties.mode as string).toLocaleUpperCase()}
                  </ModelBadge>
                )
              }
              {
                modelItem.features?.map(feature => (
                  <FeatureIcon
                    key={feature}
                    feature={feature}
                  />
                ))
              }
            </div>
            <div className='grow' />
            {
              defaultModel?.model === modelItem.model && (
                <Check className='shrink-0 w-4 h-4 text-primary-600' />
              )
            }
            {
              modelItem.status === ModelStatusEnum.noConfigure && (
                <div className='hidden group-hover:block text-xs font-medium text-primary-600 cursor-pointer'>
                  ADD
                </div>
              )
            }
          </div>
        ))
      }
    </div>
  )
}

export default PopupItem
