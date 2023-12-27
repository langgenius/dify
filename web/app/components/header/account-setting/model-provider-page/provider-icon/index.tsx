import type { FC } from 'react'
import type { ModelProvider } from '../declarations'
import { useLanguage } from '../hooks'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'

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
    <div className={`inline-flex items-center ${className}`}>
      <div className='flex items-center justify-center mr-2 w-6 h-6 rounded border-[0.5px] border-black/5 bg-gray-50'>
        <CubeOutline className='w-4 h-4 text-gray-400' />
      </div>
      <div className='text-xs font-semibold text-black'>
        {provider.label[language]}
      </div>
    </div>
  )
}

export default ProviderIcon
