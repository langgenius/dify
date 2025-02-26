import type { FC } from 'react'
import type {
  Model,
  ModelProvider,
} from '../declarations'
import { useLanguage } from '../hooks'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'
import { OpenaiViolet } from '@/app/components/base/icons/src/public/llm'
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

type ModelIconProps = {
  provider?: Model | ModelProvider
  modelName?: string
  className?: string
}
const ModelIcon: FC<ModelIconProps> = ({
  provider,
  className,
  modelName,
}) => {
  const language = useLanguage()

  if (provider?.provider === 'openai' && (modelName?.startsWith('gpt-4') || modelName?.includes('4o')))
    return <OpenaiViolet className={`w-4 h-4 ${className}`}/>

  if (provider?.icon_small) {
    let src = provider.icon_small[language] || provider.icon_small.en_US
    if (src && !src.includes(basePath))
      src = `${basePath}${src}`
    return (
      <img
        alt='model-icon'
        src={src}
        className={`w-4 h-4 ${className}`}
      />
    )
  }

  return (
    <div className={`
      flex items-center justify-center w-6 h-6 rounded border-[0.5px] border-black/5 bg-gray-50
      ${className}
    `}>
      <CubeOutline className='w-4 h-4 text-gray-400' />
    </div>
  )
}

export default ModelIcon
