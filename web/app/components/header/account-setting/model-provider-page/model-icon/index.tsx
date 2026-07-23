import type { FC } from 'react'
import type { Model, ModelProvider } from '../declarations'
import { cn } from '@langgenius/dify-ui/cn'
import { OpenaiYellow } from '@/app/components/base/icons/src/public/llm'
import useTheme from '@/hooks/use-theme'
import { renderI18nObject } from '@/i18n-config'
import { Theme } from '@/types/app'
import { useLanguage } from '../hooks'

type ModelIconProps = {
  provider?: Model | ModelProvider
  modelName?: string
  className?: string
  iconClassName?: string
  isDeprecated?: boolean
}
const ModelIcon: FC<ModelIconProps> = ({
  provider,
  className,
  modelName,
  iconClassName,
  isDeprecated = false,
}) => {
  const { theme } = useTheme()
  const language = useLanguage()
  const lightIconUrl = provider?.icon_small ? renderI18nObject(provider.icon_small, language) : ''
  const darkIconUrl = provider?.icon_small_dark
    ? renderI18nObject(provider.icon_small_dark, language)
    : ''
  const iconUrl = theme === Theme.dark ? darkIconUrl || lightIconUrl : lightIconUrl

  if (
    provider?.provider &&
    ['openai', 'langgenius/openai/openai'].includes(provider.provider) &&
    modelName?.startsWith('o')
  )
    return (
      <div className="flex items-center justify-center">
        <OpenaiYellow className={cn('size-5', className)} />
      </div>
    )

  if (iconUrl) {
    return (
      <div
        className={cn(
          'flex size-5 items-center justify-center',
          isDeprecated && 'opacity-50',
          className,
        )}
      >
        <img alt="model-icon" src={iconUrl} className={iconClassName} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle',
        className,
      )}
    >
      <div className={cn('flex size-5 items-center justify-center opacity-35', iconClassName)}>
        <span aria-hidden className="i-custom-vender-other-group size-3 text-text-tertiary" />
      </div>
    </div>
  )
}

export default ModelIcon
