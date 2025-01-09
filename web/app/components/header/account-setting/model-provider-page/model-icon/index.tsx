import type { FC } from 'react'
import type {
  Model,
  ModelProvider,
} from '../declarations'
import { useLanguage } from '../hooks'
import { Group } from '@/app/components/base/icons/src/vender/other'
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
    return <div className='flex items-center justify-center'><OpenaiBlue className={cn('w-5 h-5', className)}/></div>
  if (provider?.provider.includes('openai') && modelName?.startsWith('gpt-4'))
    return <div className='flex items-center justify-center'><OpenaiViolet className={cn('w-5 h-5', className)}/></div>

  if (provider?.icon_small) {
    return (
      <div className={`flex items-center justify-center w-5 h-5 ${isDeprecated ? 'opacity-50' : ''}`}>
        <img
          alt='model-icon'
          src={`${provider.icon_small[language] || provider.icon_small.en_US}`}
          className={cn('w-4.5 h-4.5', className)}
        />
      </div>
    )
  }

  return (
    <div className={cn(
      'flex items-center justify-center rounded-md border-[0.5px] w-5 h-5 border-components-panel-border-subtle bg-background-default-subtle',
      className,
    )}>
      <div className='flex w-5 h-5 items-center justify-center opacity-35'>
        <Group className='text-text-tertiary w-3 h-3' />
      </div>
    </div>
  )
}

export default ModelIcon
