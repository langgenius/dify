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
        src={`${provider.icon_large[language] || provider.icon_large.en_US}?_token=${localStorage.getItem('console_token')}`}
        className={`w-auto h-6 ${className}`}
      />
    )
  }

  return (
    <div className={`inline-flex items-center ${className}`}>
      <div className='text-xs font-semibold text-black'>
        {provider.label[language]}
      </div>
    </div>
  )
}

export default ProviderIcon
