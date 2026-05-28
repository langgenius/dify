import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { ModelFeatureEnum, ModelFeatureTextEnum } from '../declarations'
import ModelBadge from '../model-badge'

type FeatureIconProps = {
  feature: ModelFeatureEnum
  className?: string
  showFeaturesLabel?: boolean
}
function FeatureIcon({
  className,
  feature,
  showFeaturesLabel,
}: FeatureIconProps) {
  const { t } = useTranslation()

  if (feature === ModelFeatureEnum.vision) {
    if (showFeaturesLabel) {
      return (
        <ModelBadge
          className={cn('gap-x-0.5', className)}
        >
          <span className="i-ri-image-circle-ai-line size-3" aria-hidden="true" />
          <span>{ModelFeatureTextEnum.vision}</span>
        </ModelBadge>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger
          render={(
            <div className="inline-block cursor-help">
              <ModelBadge
                className={cn(
                  'w-4.5 justify-center px-0!',
                  className,
                )}
              >
                <span className="i-ri-image-circle-ai-line size-3" aria-hidden="true" />
              </ModelBadge>
            </div>
          )}
        />
        <TooltipContent>
          {t('modelProvider.featureSupported', { ns: 'common', feature: ModelFeatureTextEnum.vision })}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (feature === ModelFeatureEnum.document) {
    if (showFeaturesLabel) {
      return (
        <ModelBadge
          className={cn('gap-x-0.5', className)}
        >
          <span className="i-ri-file-text-line size-3" aria-hidden="true" />
          <span>{ModelFeatureTextEnum.document}</span>
        </ModelBadge>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger
          render={(
            <div className="inline-block cursor-help">
              <ModelBadge
                className={cn(
                  'w-4.5 justify-center px-0!',
                  className,
                )}
              >
                <span className="i-ri-file-text-line size-3" aria-hidden="true" />
              </ModelBadge>
            </div>
          )}
        />
        <TooltipContent>
          {t('modelProvider.featureSupported', { ns: 'common', feature: ModelFeatureTextEnum.document })}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (feature === ModelFeatureEnum.audio) {
    if (showFeaturesLabel) {
      return (
        <ModelBadge
          className={cn('gap-x-0.5', className)}
        >
          <span className="i-ri-voice-ai-fill size-3" aria-hidden="true" />
          <span>{ModelFeatureTextEnum.audio}</span>
        </ModelBadge>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger
          render={(
            <div className="inline-block cursor-help">
              <ModelBadge
                className={cn(
                  'w-4.5 justify-center px-0!',
                  className,
                )}
              >
                <span className="i-ri-voice-ai-fill size-3" aria-hidden="true" />
              </ModelBadge>
            </div>
          )}
        />
        <TooltipContent>
          {t('modelProvider.featureSupported', { ns: 'common', feature: ModelFeatureTextEnum.audio })}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (feature === ModelFeatureEnum.video) {
    if (showFeaturesLabel) {
      return (
        <ModelBadge
          className={cn('gap-x-0.5', className)}
        >
          <span className="i-ri-film-ai-line size-3" aria-hidden="true" />
          <span>{ModelFeatureTextEnum.video}</span>
        </ModelBadge>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger
          render={(
            <div className="inline-block cursor-help">
              <ModelBadge
                className={cn(
                  'w-4.5 justify-center px-0!',
                  className,
                )}
              >
                <span className="i-ri-film-ai-line size-3" aria-hidden="true" />
              </ModelBadge>
            </div>
          )}
        />
        <TooltipContent>
          {t('modelProvider.featureSupported', { ns: 'common', feature: ModelFeatureTextEnum.video })}
        </TooltipContent>
      </Tooltip>
    )
  }

  return null
}

export default FeatureIcon
