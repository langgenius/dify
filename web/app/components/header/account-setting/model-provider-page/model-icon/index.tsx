import type { FC } from 'react'
import type {
  Model,
  ModelProvider,
} from '../declarations'
import { useLanguage } from '../hooks'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'
import { OpenaiBlue, OpenaiViolet } from '@/app/components/base/icons/src/public/llm'
import cn from '@/utils/classnames'

type ModelIconProps = {
  provider?: Model | ModelProvider
  modelName?: string
  className?: string
  isDeprecated?: boolean
}
const ModelIcon: FC<ModelIconProps> = ({
  provider,
  className,
  modelName,
  isDeprecated = false,
}) => {
  const language = useLanguage()
  if (provider?.provider.includes('openai') && modelName?.includes('gpt-4o'))
    return <OpenaiBlue className={cn('w-5 h-5', className)}/>
  if (provider?.provider.includes('openai') && modelName?.startsWith('gpt-4'))
    return <OpenaiViolet className={cn('w-5 h-5', className)}/>

  if (provider?.icon_small) {
    return (

      <div className={isDeprecated ? 'opacity-50' : ''}>
        <img
          alt='model-icon'
          src={`${provider.icon_small[language] || provider.icon_small.en_US}`}
          className={cn('w-4 h-4', className)}
        />
      </div>
    )
  }

  return (
    <div className={cn(
      'flex items-center justify-center w-6 h-6 rounded border-[0.5px] border-black/5 bg-gray-50',
      className,
    )}>
      <CubeOutline className='w-4 h-4 text-text-quaternary' />
    </div>
  )
}

export default ModelIcon
