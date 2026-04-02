import type { FC, ReactNode } from 'react'
import type { PluginStatus } from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import CardIcon from '@/app/components/plugins/card/base/card-icon'

type PluginItemProps = {
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
        <div className="absolute -right-0.5 -bottom-0.5 z-10">
          {statusIcon}
        </div>
      </div>
      <div className="flex min-w-0 grow flex-col gap-0.5 px-1">
        <div className="truncate system-sm-medium text-text-secondary">
          {plugin.labels[language]}
        </div>
        <div className={`min-w-0 system-xs-regular break-words ${statusClassName || 'text-text-tertiary'}`}>
          {statusText}
        </div>
        {action}
      </div>
      {onClear && (
        <button
          type="button"
          className="invisible flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-md group-hover/item:visible hover:bg-state-base-hover-alt"
          onClick={onClear}
        >
          <span className="i-ri-close-line h-4 w-4 text-text-tertiary" />
        </button>
      )}
    </div>
  )
}

export default PluginItem
