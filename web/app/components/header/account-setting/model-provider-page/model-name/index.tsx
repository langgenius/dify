import type { FC, PropsWithChildren } from 'react'
import type { ModelItem } from '../declarations'
import { cn } from '@/utils/classnames'
import { useLanguage } from '../hooks'
import ModelBadge from '../model-badge'
import FeatureIcon from '../model-selector/feature-icon'
import {
  modelTypeFormat,
  sizeFormat,
} from '../utils'

type ModelNameProps = PropsWithChildren<{
  modelItem: ModelItem
  className?: string
  showModelType?: boolean
  modelTypeClassName?: string
  showMode?: boolean
  modeClassName?: string
  showFeatures?: boolean
  showFeaturesLabel?: boolean
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
  showFeaturesLabel,
  featuresClassName,
  showContextSize,
  children,
}) => {
  const language = useLanguage()

  if (!modelItem)
    return null
  return (
    <div className={cn('system-sm-regular flex items-center gap-0.5 overflow-hidden truncate text-ellipsis text-components-input-text-filled', className)}>
      <div
        className="truncate"
        title={modelItem.label[language] || modelItem.label.en_US}
      >
        {modelItem.label[language] || modelItem.label.en_US}
      </div>
      <div className="flex items-center gap-0.5">
        {
          !!(showModelType && modelItem.model_type) && (
            <ModelBadge className={modelTypeClassName}>
              {modelTypeFormat(modelItem.model_type)}
            </ModelBadge>
          )
        }
        {
          !!(modelItem.model_properties.mode && showMode) && (
            <ModelBadge className={modeClassName}>
              {(modelItem.model_properties.mode as string).toLocaleUpperCase()}
            </ModelBadge>
          )
        }
        {
          !!(showContextSize && modelItem.model_properties.context_size) && (
            <ModelBadge>
              {sizeFormat(modelItem.model_properties.context_size as number)}
            </ModelBadge>
          )
        }
        {
          showFeatures && modelItem.features?.map(feature => (
            <FeatureIcon
              key={feature}
              feature={feature}
              className={featuresClassName}
              showFeaturesLabel={showFeaturesLabel}
            />
          ))
        }
      </div>
      {children}
    </div>
  )
}

export default ModelName
