import type { FC, PropsWithChildren } from 'react'
import type { ModelSelectorModel } from '../model-selector/types'
import { cn } from '@langgenius/dify-ui/cn'
import { renderI18nObject } from '@/i18n-config'
import { useLanguage } from '../hooks'
import ModelBadge from '../model-badge'
import FeatureIcon from '../model-selector/feature-icon'
import { modelTypeFormat, sizeFormat } from '../utils'

type ModelNameProps = PropsWithChildren<{
  modelItem?: ModelSelectorModel
  className?: string
  nameClassName?: string
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
  nameClassName,
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

  if (!modelItem) return null

  const label = renderI18nObject(modelItem.label, language)

  return (
    <span
      className={cn(
        'flex items-center gap-0.5 truncate overflow-hidden system-sm-regular text-ellipsis text-components-input-text-filled',
        className,
      )}
    >
      <span className={cn('truncate', nameClassName)} title={label}>
        {label}
      </span>
      <span className="flex items-center gap-0.5">
        {!!(showModelType && modelItem.model_type) && (
          <ModelBadge className={modelTypeClassName}>
            {modelTypeFormat(modelItem.model_type)}
          </ModelBadge>
        )}
        {!!(modelItem.model_properties.mode && showMode) && (
          <ModelBadge className={modeClassName}>
            {(modelItem.model_properties.mode as string).toLocaleUpperCase()}
          </ModelBadge>
        )}
        {!!(showContextSize && modelItem.model_properties.context_size) && (
          <ModelBadge>{sizeFormat(modelItem.model_properties.context_size as number)}</ModelBadge>
        )}
        {showFeatures &&
          modelItem.features?.map((feature) => (
            <FeatureIcon
              key={feature}
              feature={feature}
              className={featuresClassName}
              showFeaturesLabel={showFeaturesLabel}
            />
          ))}
      </span>
      {children}
    </span>
  )
}

export default ModelName
