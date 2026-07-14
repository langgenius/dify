import type { ReactNode } from 'react'
import type { PluginStatus } from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
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

function PluginSection({
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
}: PluginSectionProps) {
  if (plugins.length === 0) return null

  return (
    <>
      <div className="sticky top-0 flex items-start justify-between pt-1 pr-1 pl-2 system-sm-semibold-uppercase text-text-secondary">
        <span className="flex h-6 items-center">
          {title} ({count})
        </span>
        {headerAction}
      </div>
      <ScrollArea
        className="overflow-hidden"
        label={title}
        slotClassNames={{
          viewport: 'overscroll-contain',
          content: 'min-w-0',
        }}
      >
        {plugins.map((plugin) => (
          <PluginItem
            key={plugin.plugin_unique_identifier}
            plugin={plugin}
            getIconUrl={getIconUrl}
            language={language}
            statusIcon={statusIcon}
            statusText={plugin.message || defaultStatusText}
            statusClassName={statusClassName}
            action={renderItemAction?.(plugin)}
            onClear={
              onClearSingle
                ? () => onClearSingle(plugin.taskId, plugin.plugin_unique_identifier)
                : undefined
            }
          />
        ))}
      </ScrollArea>
    </>
  )
}

export default PluginSection
