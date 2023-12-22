import type { FC } from 'react'
import type { ModelProvider } from '../declarations'
import { useLanguage } from '../hooks'

type ProviderIconProps = {
  provider: ModelProvider
  className?: string
}
const ProviderIcon: FC<ProviderIconProps> = ({
  provider,
  className,
}) => {
  const language = useLanguage()

  if (provider.icon_large) {
    return (
      <img
        alt='provider-icon'
        src={`${provider.icon_large[language]}?_token=${localStorage.getItem('console_token')}`}
        className={`w-auto h-6 ${className}`}
      />
    )
  }

  return (
    <div className={`inline-flex items-center pl-[1px] pr-0.5 h-6 bg-[#D92D201F]/[0.12] ${className}`}>
      <div className='mr-1 w-[22px] h-[22px] rounded-full bg-black/[0.24]' />
      <div className='pl-[7px] pr-[18px] h-[14px] leading-[14px] bg-black/[0.24] text-xs font-medium text-black/[0.16]'>
        Model Provider Image
      </div>
    </div>
  )
}

export default ProviderIcon
