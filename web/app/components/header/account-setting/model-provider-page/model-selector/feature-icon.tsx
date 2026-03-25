import type { FC } from 'react'
import {
  RiFileTextLine,
  RiFilmAiLine,
  RiImageCircleAiLine,
  RiVoiceAiFill,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'
import {
  ModelFeatureEnum,
  ModelFeatureTextEnum,
} from '../declarations'
import ModelBadge from '../model-badge'

type FeatureIconProps = {
  feature: ModelFeatureEnum
  className?: string
  showFeaturesLabel?: boolean
}
const FeatureIcon: FC<FeatureIconProps> = ({
  className,
  feature,
  showFeaturesLabel,
}) => {
  const { t } = useTranslation()

  // if (feature === ModelFeatureEnum.agentThought) {
  //   return (
  //     <Tooltip
  //       popupContent={t('common.modelProvider.featureSupported', { feature: ModelFeatureTextEnum.agentThought })}
  //     >
  //       <ModelBadge className={`mr-0.5 !px-0 w-[18px] justify-center text-gray-500 ${className}`}>
  //         <Robot className='w-3 h-3' />
  //       </ModelBadge>
  //     </Tooltip>
  //   )
  // }

  // if (feature === ModelFeatureEnum.toolCall) {
  //   return (
  //     <Tooltip
  //       popupContent={t('common.modelProvider.featureSupported', { feature: ModelFeatureTextEnum.toolCall })}
  //     >
  //       <ModelBadge className={`mr-0.5 !px-0 w-[18px] justify-center text-gray-500 ${className}`}>
  //         <MagicWand className='w-3 h-3' />
  //       </ModelBadge>
  //     </Tooltip>
  //   )
  // }

  // if (feature === ModelFeatureEnum.multiToolCall) {
  //   return (
  //     <Tooltip
  //       popupContent={t('common.modelProvider.featureSupported', { feature: ModelFeatureTextEnum.multiToolCall })}
  //     >
  //       <ModelBadge className={`mr-0.5 !px-0 w-[18px] justify-center text-gray-500 ${className}`}>
  //         <MagicBox className='w-3 h-3' />
  //       </ModelBadge>
  //     </Tooltip>
  //   )
  // }

  if (feature === ModelFeatureEnum.vision) {
    if (showFeaturesLabel) {
      return (
        <ModelBadge
          className={cn('gap-x-0.5', className)}
        >
          <RiImageCircleAiLine className="size-3" />
          <span>{ModelFeatureTextEnum.vision}</span>
        </ModelBadge>
      )
    }

    return (
      <Tooltip
        popupContent={t('modelProvider.featureSupported', { ns: 'common', feature: ModelFeatureTextEnum.vision })}
      >
        <div className="inline-block cursor-help">
          <ModelBadge
            className={cn(
              'w-[18px] justify-center !px-0',
              className,
            )}
          >
            <RiImageCircleAiLine className="size-3" />
          </ModelBadge>
        </div>
      </Tooltip>
    )
  }

  if (feature === ModelFeatureEnum.document) {
    if (showFeaturesLabel) {
      return (
        <ModelBadge
          className={cn('gap-x-0.5', className)}
        >
          <RiFileTextLine className="size-3" />
          <span>{ModelFeatureTextEnum.document}</span>
        </ModelBadge>
      )
    }

    return (
      <Tooltip
        popupContent={t('modelProvider.featureSupported', { ns: 'common', feature: ModelFeatureTextEnum.document })}
      >
        <div className="inline-block cursor-help">
          <ModelBadge
            className={cn(
              'w-[18px] justify-center !px-0',
              className,
            )}
          >
            <RiFileTextLine className="size-3" />
          </ModelBadge>
        </div>
      </Tooltip>
    )
  }

  if (feature === ModelFeatureEnum.audio) {
    if (showFeaturesLabel) {
      return (
        <ModelBadge
          className={cn('gap-x-0.5', className)}
        >
          <RiVoiceAiFill className="size-3" />
          <span>{ModelFeatureTextEnum.audio}</span>
        </ModelBadge>
      )
    }

    return (
      <Tooltip
        popupContent={t('modelProvider.featureSupported', { ns: 'common', feature: ModelFeatureTextEnum.audio })}
      >
        <div className="inline-block cursor-help">
          <ModelBadge
            className={cn(
              'w-[18px] justify-center !px-0',
              className,
            )}
          >
            <RiVoiceAiFill className="size-3" />
          </ModelBadge>
        </div>
      </Tooltip>
    )
  }

  if (feature === ModelFeatureEnum.video) {
    if (showFeaturesLabel) {
      return (
        <ModelBadge
          className={cn('gap-x-0.5', className)}
        >
          <RiFilmAiLine className="size-3" />
          <span>{ModelFeatureTextEnum.video}</span>
        </ModelBadge>
      )
    }

    return (
      <Tooltip
        popupContent={t('modelProvider.featureSupported', { ns: 'common', feature: ModelFeatureTextEnum.video })}
      >
        <div className="inline-block cursor-help">
          <ModelBadge
            className={cn(
              'w-[18px] justify-center !px-0',
              className,
            )}
          >
            <RiFilmAiLine className="size-3" />
          </ModelBadge>
        </div>
      </Tooltip>
    )
  }

  return null
}

export default FeatureIcon
