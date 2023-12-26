import type { FC } from 'react'
import type {
  Model,
  ModelProvider,
} from '../declarations'
import { useLanguage } from '../hooks'

type ModelIconProps = {
  provider?: Model | ModelProvider
  className?: string
}
const ModelIcon: FC<ModelIconProps> = ({
  provider,
  className,
}) => {
  const language = useLanguage()

  if (provider?.icon_small) {
    return (
      <img
        alt='model-icon'
        src={`${provider.icon_small[language]}?_token=${localStorage.getItem('console_token')}`}
        className={`w-4 h-4 ${className}`}
      />
    )
  }

  return (
    <div className={`inline-flex items-center justify-center p-[1px] w-4 h-4 bg-[#D92D201F]/[0.12] rounded-[5px] ${className}`}>
      <div className='w-full h-full rounded-full bg-black/[0.24]' />
    </div>
  )
}

export default ModelIcon
