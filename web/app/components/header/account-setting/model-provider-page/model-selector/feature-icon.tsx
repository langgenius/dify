import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import ModelBadge from '../model-badge'
import {
  ModelFeatureEnum,
  ModelFeatureTextEnum,
} from '../declarations'
import {
  // MagicBox,
  MagicEyes,
  // MagicWand,
  // Robot,
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
          <ModelBadge className={`mr-0.5 !px-0 w-[18px] justify-center text-gray-500 ${className}`}>
            <MagicEyes className='w-3 h-3' />
          </ModelBadge>
        </div>
      </Tooltip>
    )
  }

  return null
}

export default FeatureIcon
