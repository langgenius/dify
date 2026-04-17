import type { FC, ReactNode } from 'react'
import type { PluginStatus } from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import PluginItem from './plugin-item'

type PluginSectionProps = {
  title: string
  count: number
  plugins: PluginStatus[]
  getIconUrl: (icon: string) => string
  language: Locale
  statusIcon: ReactNode
  defaultStatusText: ReactNode
  statusClassName?: string
  headerAction?: ReactNode
  renderItemAction?: (plugin: PluginStatus) => ReactNode
  onClearSingle?: (taskId: string, pluginId: string) => void
}

const PluginSection: FC<PluginSectionProps> = ({
  title,
  count,
  plugins,
  getIconUrl,
  language,
  statusIcon,
  defaultStatusText,
  statusClassName,
  headerAction,
  renderItemAction,
  onClearSingle,
}) => {
  if (plugins.length === 0)
    return null

  return (
    <>
      <div className="sticky top-0 flex h-7 items-center justify-between px-2 pt-1 system-sm-semibold-uppercase text-text-secondary">
        {title}
        {' '}
        (
        {count}
        )
        {headerAction}
      </div>
      <div className="max-h-[300px] overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {plugins.map(plugin => (
          <PluginItem
            key={plugin.plugin_unique_identifier}
            plugin={plugin}
            getIconUrl={getIconUrl}
            language={language}
            statusIcon={statusIcon}
            statusText={plugin.message || defaultStatusText}
            statusClassName={statusClassName}
            action={renderItemAction?.(plugin)}
            onClear={onClearSingle
              ? () => onClearSingle(plugin.taskId, plugin.plugin_unique_identifier)
              : undefined}
          />
        ))}
      </div>
    </>
  )
}

export default PluginSection
