import type { FC } from 'react'
import ModelBadge from '../model-badge'
import { ModelFeatureEnum } from '../declarations'
import {
  MagicBox,
  MagicEyes,
  MagicWand,
  Robot,
} from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'

type FeatureIconProps = {
  feature: ModelFeatureEnum
}
const FeatureIcon: FC<FeatureIconProps> = ({
  feature,
}) => {
  if (feature === ModelFeatureEnum.agentThought) {
    return (
      <ModelBadge className='mr-0.5 !px-0 w-[18px] justify-center'>
        <Robot className='w-3 h-3 text-gray-500' />
      </ModelBadge>
    )
  }

  if (feature === ModelFeatureEnum.toolCall) {
    return (
      <ModelBadge className='mr-0.5 !px-0 w-[18px] justify-center'>
        <MagicWand className='w-3 h-3 text-gray-500' />
      </ModelBadge>
    )
  }

  if (feature === ModelFeatureEnum.multiToolCall) {
    return (
      <ModelBadge className='mr-0.5 !px-0 w-[18px] justify-center'>
        <MagicBox className='w-3 h-3 text-gray-500' />
      </ModelBadge>
    )
  }

  if (feature === ModelFeatureEnum.vision) {
    return (
      <ModelBadge className='mr-0.5 !px-0 w-[18px] justify-center'>
        <MagicEyes className='w-3 h-3 text-gray-500' />
      </ModelBadge>
    )
  }

  return null
}

export default FeatureIcon
