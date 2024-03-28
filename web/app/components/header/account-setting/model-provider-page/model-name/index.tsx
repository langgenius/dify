import type { FC } from 'react'
import {
  modelTypeFormat,
  sizeFormat,
} from '../utils'
import { useLanguage } from '../hooks'
import type { ModelItem } from '../declarations'
import ModelBadge from '../model-badge'
import FeatureIcon from '../model-selector/feature-icon'

type ModelNameProps = {
  modelItem: ModelItem
  className?: string
  showModelType?: boolean
  modelTypeClassName?: string
  showMode?: boolean
  modeClassName?: string
  showFeatures?: boolean
  featuresClassName?: string
  showContextSize?: boolean
}
const ModelName: FC<ModelNameProps> = ({
  modelItem,
  className,
  showModelType,
  modelTypeClassName,
  showMode,
  modeClassName,
  showFeatures,
  featuresClassName,
  showContextSize,
}) => {
  const language = useLanguage()

  if (!modelItem)
    return null
  return (
    <div
      className={`
        flex items-center truncate text-[13px] font-medium text-gray-800
        ${className}
      `}
    >
      <div
        className='mr-1 truncate'
        title={modelItem.label[language] || modelItem.label.en_US}
      >
        {modelItem.label[language] || modelItem.label.en_US}
      </div>
      {
        showModelType && modelItem.model_type && (
          <ModelBadge className={`mr-0.5 ${modelTypeClassName}`}>
            {modelTypeFormat(modelItem.model_type)}
          </ModelBadge>
        )
      }
      {
        modelItem.model_properties.mode && showMode && (
          <ModelBadge className={`mr-0.5 ${modeClassName}`}>
            {(modelItem.model_properties.mode as string).toLocaleUpperCase()}
          </ModelBadge>
        )
      }
      {
        showFeatures && modelItem.features?.map(feature => (
          <FeatureIcon
            key={feature}
            feature={feature}
            className={featuresClassName}
          />
        ))
      }
      {
        showContextSize && modelItem.model_properties.context_size && (
          <ModelBadge>
            {sizeFormat(modelItem.model_properties.context_size as number)}
          </ModelBadge>
        )
      }
    </div>
  )
}

export default ModelName
