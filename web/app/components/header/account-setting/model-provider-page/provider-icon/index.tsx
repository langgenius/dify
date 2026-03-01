import type { FC } from 'react'
import type { ModelProvider } from '../declarations'
import { AnthropicDark, AnthropicLight } from '@/app/components/base/icons/src/public/llm'
import { Openai } from '@/app/components/base/icons/src/vender/other'
import useTheme from '@/hooks/use-theme'
import { renderI18nObject } from '@/i18n-config'
import { Theme } from '@/types/app'
import { cn } from '@/utils/classnames'
import { useLanguage } from '../hooks'

type ProviderIconProps = {
  provider: ModelProvider
  className?: string
}
const ProviderIcon: FC<ProviderIconProps> = ({
  provider,
  className,
}) => {
  const { theme } = useTheme()
  const language = useLanguage()

  if (provider.provider === 'langgenius/anthropic/anthropic') {
    return (
      <div className="mb-2 py-[7px]">
        {theme === Theme.dark && <AnthropicLight className="h-2.5 w-[90px]" />}
        {theme === Theme.light && <AnthropicDark className="h-2.5 w-[90px]" />}
      </div>
    )
  }

  if (provider.provider === 'langgenius/openai/openai') {
    return (
      <div className="mb-2">
        <Openai className="h-6 w-auto text-text-inverted-dimmed" />
      </div>
    )
  }

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <img
        alt="provider-icon"
        src={renderI18nObject(
          theme === Theme.dark && provider.icon_small_dark
            ? provider.icon_small_dark
            : provider.icon_small,
          language,
        )}
        className="h-6 w-6"
      />
      <div className="system-md-semibold text-text-primary">
        {renderI18nObject(provider.label, language)}
      </div>
    </div>
  )
}

export default ProviderIcon
