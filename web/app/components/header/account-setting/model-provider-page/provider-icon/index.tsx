import type { FC } from 'react'
import type { ModelProvider } from '../declarations'
import { useLanguage } from '../hooks'
import { useAppContext } from '@/context/app-context'
import { Openai } from '@/app/components/base/icons/src/vender/other'
import { AnthropicDark, AnthropicLight } from '@/app/components/base/icons/src/public/llm'
import { renderI18nObject } from '@/hooks/use-i18n'
import { Theme } from '@/types/app'
import cn from '@/utils/classnames'

type ProviderIconProps = {
  provider: ModelProvider
  className?: string
}
const ProviderIcon: FC<ProviderIconProps> = ({
  provider,
  className,
}) => {
  const { theme } = useAppContext()
  const language = useLanguage()

  if (provider.provider === 'langgenius/anthropic/anthropic') {
    return (
      <div className='mb-2 py-[7px]'>
        {theme === Theme.dark && <AnthropicLight className='h-2.5 w-[90px]' />}
        {theme === Theme.light && <AnthropicDark className='h-2.5 w-[90px]' />}
      </div>
    )
  }

  if (provider.provider === 'langgenius/openai/openai') {
    return (
      <div className='mb-2'>
        <Openai className='text-text-inverted-dimmed h-6 w-auto' />
      </div>
    )
  }

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <img
        alt='provider-icon'
        src={renderI18nObject(provider.icon_small, language)}
        className='h-6 w-6'
      />
      <div className='system-md-semibold text-text-primary'>
        {renderI18nObject(provider.label, language)}
      </div>
    </div>
  )
}

export default ProviderIcon
