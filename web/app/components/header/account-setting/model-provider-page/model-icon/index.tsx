import type { FC } from 'react'
import type {
  Model,
  ModelProvider,
} from '../declarations'
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
  modelName,
  iconClassName,
  isDeprecated = false,
}) => {
  const { theme } = useTheme()
  const language = useLanguage()
  if (provider?.provider && ['openai', 'langgenius/openai/openai'].includes(provider.provider) && modelName?.startsWith('o'))
    return <div className="flex items-center justify-center"><OpenaiYellow className={cn('h-5 w-5', className)} /></div>

  if (provider?.icon_small) {
    return (
      <div className={cn('flex h-5 w-5 items-center justify-center', isDeprecated && 'opacity-50', className)}>
        <img
          alt="model-icon"
          src={renderI18nObject(
            theme === Theme.dark && provider.icon_small_dark
              ? provider.icon_small_dark
              : provider.icon_small,
            language,
          )}
          className={iconClassName}
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
