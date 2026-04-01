import type { FC, ReactNode } from 'react'
import type { PluginStatus } from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import CardIcon from '@/app/components/plugins/card/base/card-icon'

export type PluginItemProps = {
  plugin: PluginStatus
  getIconUrl: (icon: string) => string
  language: Locale
  statusIcon: ReactNode
  statusText: ReactNode
  statusClassName?: string
  action?: ReactNode
  onClear?: () => void
}

const PluginItem: FC<PluginItemProps> = ({
  plugin,
  getIconUrl,
  language,
  statusIcon,
  statusText,
  statusClassName,
  action,
  onClear,
}) => {
  return (
    <div className="group/item flex gap-1 rounded-lg p-2 hover:bg-state-base-hover">
      <div className="relative shrink-0 self-start">
        <CardIcon
          size="small"
          src={getIconUrl(plugin.icon)}
        />
        <div className="absolute -bottom-0.5 -right-0.5 z-10">
          {statusIcon}
        </div>
      </div>
      <div className="flex min-w-0 grow flex-col gap-0.5 px-1">
        <div className="truncate text-text-secondary system-sm-medium">
          {plugin.labels[language]}
        </div>
        <div className={`system-xs-regular ${statusClassName || 'text-text-tertiary'}`}>
          {statusText}
        </div>
        {action}
      </div>
      {onClear && (
        <button
          type="button"
          className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-state-base-hover-alt group-hover/item:flex"
          onClick={onClear}
        >
          <span className="i-ri-close-line h-4 w-4 text-text-tertiary" />
        </button>
      )}
    </div>
  )
}

export default PluginItem
