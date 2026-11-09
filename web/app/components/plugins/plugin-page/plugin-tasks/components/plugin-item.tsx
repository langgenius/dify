import type { ReactNode } from 'react'
import type { PluginStatus } from '@/app/components/plugins/types'
import type { PluginLanguage } from '@/i18n/metadata'
import CardIcon from '@/app/components/plugins/card/base/card-icon'

type PluginItemProps = {
  plugin: PluginStatus
  getIconUrl: (icon: string) => string
  language: PluginLanguage
  statusIcon: ReactNode
  statusText: ReactNode
  statusClassName?: string
  action?: ReactNode
  onClear?: () => void
}

function PluginItem({
  plugin,
  getIconUrl,
  language,
  statusIcon,
  statusText,
  statusClassName,
  action,
  onClear,
}: PluginItemProps) {
  const hasPluginIcon = !!plugin.icon
  const pluginName = plugin.labels[language] || plugin.plugin_unique_identifier

  return (
    <div className="group/item flex w-full max-w-full min-w-0 gap-1 overflow-hidden rounded-lg p-2 hover:bg-state-base-hover">
      <div className="relative shrink-0 self-start">
        {hasPluginIcon ? (
          <CardIcon size="small" src={getIconUrl(plugin.icon)} />
        ) : (
          <span
            aria-hidden
            className="i-custom-vender-solid-mediaAndDevices-magic-box size-8 text-text-tertiary"
          />
        )}
        <div className="absolute -right-0.5 -bottom-0.5 z-10">{statusIcon}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-1 wrap-anywhere">
        <div className="truncate system-sm-medium text-text-secondary">
          {plugin.labels[language]}
        </div>
        <div
          className={`max-w-full min-w-0 system-xs-regular wrap-anywhere wrap-break-word ${statusClassName || 'text-text-tertiary'}`}
        >
          {statusText}
        </div>
        {action}
      </div>
      {onClear && (
        <button
          type="button"
          aria-label={`Clear ${pluginName}`}
          className="flex size-6 shrink-0 items-center justify-center self-start rounded-md opacity-0 outline-hidden group-hover/item:opacity-100 hover:bg-state-base-hover-alt focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid [@media(hover:none)]:opacity-100"
          onClick={onClear}
        >
          <span className="i-ri-close-line size-4 text-text-tertiary" />
        </button>
      )}
    </div>
  )
}

export default PluginItem
