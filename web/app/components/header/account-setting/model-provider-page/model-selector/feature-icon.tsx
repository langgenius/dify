import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import ModelBadge from '../model-badge'
import {
  ModelFeatureEnum,
  ModelFeatureTextEnum,
} from '../declarations'
import {
  AudioSupportIcon,
  DocumentSupportIcon,
  // MagicBox,
  MagicEyes,
  // MagicWand,
  // Robot,
  VideoSupportIcon,
} from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import Tooltip from '@/app/components/base/tooltip'

type FeatureIconProps = {
  feature: ModelFeatureEnum
  className?: string
}
const FeatureIcon: FC<FeatureIconProps> = ({
  className,
  feature,
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
    return (
      <Tooltip
        popupContent={t('common.modelProvider.featureSupported', { feature: ModelFeatureTextEnum.vision })}
      >
        <div className='inline-block cursor-help'>
          <ModelBadge className={`w-[18px] justify-center !px-0 text-text-tertiary ${className}`}>
            <MagicEyes className='h-3 w-3' />
          </ModelBadge>
        </div>
      </Tooltip>
    )
  }

  if (feature === ModelFeatureEnum.document) {
    return (
      <Tooltip
        popupContent={t('common.modelProvider.featureSupported', { feature: ModelFeatureTextEnum.document })}
      >
        <div className='inline-block cursor-help'>
          <ModelBadge className={`w-[18px] justify-center !px-0 text-text-tertiary ${className}`}>
            <DocumentSupportIcon className='h-3 w-3' />
          </ModelBadge>
        </div>
      </Tooltip>
    )
  }

  if (feature === ModelFeatureEnum.audio) {
    return (
      <Tooltip
        popupContent={t('common.modelProvider.featureSupported', { feature: ModelFeatureTextEnum.audio })}
      >
        <div className='inline-block cursor-help'>
          <ModelBadge className={`w-[18px] justify-center !px-0 text-text-tertiary ${className}`}>
            <AudioSupportIcon className='h-3 w-3' />
          </ModelBadge>
        </div>
      </Tooltip>
    )
  }

  if (feature === ModelFeatureEnum.video) {
    return (
      <Tooltip
        popupContent={t('common.modelProvider.featureSupported', { feature: ModelFeatureTextEnum.video })}
      >
        <div className='inline-block cursor-help'>
          <ModelBadge className={`w-[18px] justify-center !px-0 text-text-tertiary ${className}`}>
            <VideoSupportIcon className='h-3 w-3' />
          </ModelBadge>
        </div>
      </Tooltip>
    )
  }

  return null
}

export default FeatureIcon
