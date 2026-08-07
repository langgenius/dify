import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { AnthropicDark, AnthropicLight } from '@/app/components/base/icons/src/public/llm'
import { Openai } from '@/app/components/base/icons/src/vender/other'
import useTheme from '@/hooks/use-theme'
import { renderI18nObject } from '@/i18n-config'
import { Theme } from '@/types/app'
import { useLanguage } from '../hooks'

type ProviderIconProps = {
  provider: Pick<
    ModelProviderSummaryResponse,
    'provider' | 'icon_small' | 'icon_small_dark' | 'label'
  >
  className?: string
}
const ProviderIcon: FC<ProviderIconProps> = ({ provider, className }) => {
  const { theme } = useTheme()
  const language = useLanguage()
  const lightIconUrl = provider.icon_small ? renderI18nObject(provider.icon_small, language) : ''
  const darkIconUrl = provider.icon_small_dark
    ? renderI18nObject(provider.icon_small_dark, language)
    : ''
  const iconUrl = theme === Theme.dark ? darkIconUrl || lightIconUrl : lightIconUrl

  if (provider.provider === 'langgenius/anthropic/anthropic') {
    return (
      <div className={cn('py-1.75', className)}>
        {theme === Theme.dark && <AnthropicLight className="h-2.5 w-22.5" />}
        {theme === Theme.light && <AnthropicDark className="h-2.5 w-22.5" />}
      </div>
    )
  }

  if (provider.provider === 'langgenius/openai/openai') {
    return (
      <div className={className}>
        <Openai className="h-6 w-auto text-text-inverted-dimmed" />
      </div>
    )
  }

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      {iconUrl ? (
        <img
          alt=""
          className="size-6"
          decoding="async"
          height={24}
          loading="lazy"
          src={iconUrl}
          width={24}
        />
      ) : (
        <div className="flex size-6 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
          <span aria-hidden className="i-custom-vender-other-group size-4 text-text-tertiary" />
        </div>
      )}
      <div className="system-md-semibold text-text-primary">
        {renderI18nObject(provider.label, language)}
      </div>
    </div>
  )
}

export default ProviderIcon
