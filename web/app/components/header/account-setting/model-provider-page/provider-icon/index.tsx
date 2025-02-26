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
    let src = `${provider.icon_large[language] || provider.icon_large.en_US}`
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
    if (!src.includes(basePath))
      src = `${basePath}${src}`

    return (
      <img
        alt='provider-icon'
        src={src}
        className={`w-auto h-6 ${className}`}
      />
    )
  }

  return (
    <div className={`inline-flex items-center ${className}`}>
      <div className='text-xs font-semibold text-black'>
        {provider.label[language] || provider.label.en_US}
      </div>
    </div>
  )
}

export default ProviderIcon
