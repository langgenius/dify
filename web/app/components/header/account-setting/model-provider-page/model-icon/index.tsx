import type { FC } from 'react'
import type {
  Model,
  ModelProvider,
} from '../declarations'
import { useState } from 'react'
import { OpenaiYellow } from '@/app/components/base/icons/src/public/llm'
import { Group } from '@/app/components/base/icons/src/vender/other'
import useTheme from '@/hooks/use-theme'
import { renderI18nObject } from '@/i18n-config'
import { Theme } from '@/types/app'
import { cn } from '@/utils/classnames'
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
  modelName: _modelName,
  iconClassName,
  isDeprecated = false,
}) => {
  const { theme } = useTheme()
  const language = useLanguage()
  const [failedIconSrc, setFailedIconSrc] = useState<string>()
  const iconSrc = provider?.icon_small
    ? renderI18nObject(
        theme === Theme.dark && provider.icon_small_dark
          ? provider.icon_small_dark
          : provider.icon_small,
        language,
      )
    : ''
  const shouldShowImageIcon = !!iconSrc && failedIconSrc !== iconSrc
  const isOpenAIProvider = provider?.provider && ['openai', 'langgenius/openai/openai'].includes(provider.provider)

  if (isOpenAIProvider) {
    return (
      <div className={cn('flex h-5 w-5 shrink-0 items-center justify-center', isDeprecated && 'opacity-50', className)}>
        <OpenaiYellow className={cn('h-4 w-4', iconClassName)} />
      </div>
    )
  }

  if (shouldShowImageIcon) {
    return (
      <div className={cn('flex h-5 w-5 items-center justify-center', isDeprecated && 'opacity-50', className)}>
        <img
          alt=""
          src={iconSrc}
          className={cn('h-full w-full object-contain', iconClassName)}
          onError={() => setFailedIconSrc(iconSrc)}
        />
      </div>
    )
  }

  return (
    <div className={cn(
      'flex h-5 w-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle',
      className,
    )}
    >
      <div className={cn('flex h-5 w-5 items-center justify-center opacity-35', iconClassName)}>
        <Group className="h-3 w-3 text-text-tertiary" />
      </div>
    </div>
  )
}

export default ModelIcon
