import type { FC, PropsWithChildren } from 'react'
import classNames from 'classnames'
import {
  modelTypeFormat,
  sizeFormat,
} from '../utils'
import { useLanguage } from '../hooks'
import type { ModelItem } from '../declarations'
import ModelBadge from '../model-badge'
import FeatureIcon from '../model-selector/feature-icon'

type ModelNameProps = PropsWithChildren<{
  modelItem: ModelItem
  className?: string
  showModelType?: boolean
  modelTypeClassName?: string
  showMode?: boolean
  modeClassName?: string
  showFeatures?: boolean
  featuresClassName?: string
  showContextSize?: boolean
}>
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
  children,
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
        className='truncate'
        title={modelItem.label[language] || modelItem.label.en_US}
      >
        {modelItem.label[language] || modelItem.label.en_US}
      </div>
      {
        showModelType && modelItem.model_type && (
          <ModelBadge className={classNames('ml-1', modelTypeClassName)}>
            {modelTypeFormat(modelItem.model_type)}
          </ModelBadge>
        )
      }
      {
        modelItem.model_properties.mode && showMode && (
          <ModelBadge className={classNames('ml-1', modeClassName)}>
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
          <ModelBadge className='ml-1'>
            {sizeFormat(modelItem.model_properties.context_size as number)}
          </ModelBadge>
        )
      }
      {children}
    </div>
  )
}

export default ModelName
