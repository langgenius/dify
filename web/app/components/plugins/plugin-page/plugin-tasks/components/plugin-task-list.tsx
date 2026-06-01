import type { PluginStatus } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'
import { useGetLanguage } from '@/context/i18n'
import ErrorPluginItem from './error-plugin-item'
import PluginItem from './plugin-item'
import PluginSection from './plugin-section'

type PluginTaskListProps = {
  runningPlugins: PluginStatus[]
  errorPlugins: PluginStatus[]
  getIconUrl: (icon: string) => string
  onClearErrors: () => void
  onClearSingle: (taskId: string, pluginId: string) => void
}

function PluginTaskList({
  runningPlugins,
  errorPlugins,
  getIconUrl,
  onClearErrors,
  onClearSingle,
}: PluginTaskListProps) {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const hasFailedPlugins = errorPlugins.length > 0

  return (
    <div className="w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-1 pt-1 pb-2 shadow-lg">
      {!hasFailedPlugins && runningPlugins.length > 0 && (
        <PluginSection
          title={t('task.installing', { ns: 'plugin' })}
          count={runningPlugins.length}
          plugins={runningPlugins}
          getIconUrl={getIconUrl}
          language={language}
          statusIcon={
            <span className="i-ri-loader-2-line size-3.5 animate-spin text-text-accent" />
          }
          defaultStatusText={t('task.installingHint', { ns: 'plugin' })}
        />
      )}

      {hasFailedPlugins && (
        <>
          <div className="sticky top-0 flex items-start justify-between pt-1 pr-1 pl-2 system-sm-semibold-uppercase text-text-secondary">
            {t('task.installedError', { ns: 'plugin', errorLength: errorPlugins.length })}
            <Button
              className="shrink-0"
              size="small"
              variant="ghost"
              onClick={onClearErrors}
            >
              {t('task.clearAll', { ns: 'plugin' })}
            </Button>
          </div>
          <ScrollArea
            className="max-h-[300px] overflow-hidden"
            label={t('task.installedError', { ns: 'plugin', errorLength: errorPlugins.length })}
            slotClassNames={{
              viewport: 'overscroll-contain',
              content: 'min-w-0',
            }}
          >
            {errorPlugins.map(plugin => (
              <ErrorPluginItem
                key={plugin.plugin_unique_identifier}
                plugin={plugin}
                getIconUrl={getIconUrl}
                language={language}
                onClear={() => onClearSingle(plugin.taskId, plugin.plugin_unique_identifier)}
              />
            ))}
          </ScrollArea>
          {runningPlugins.map(plugin => (
            <PluginItem
              key={plugin.plugin_unique_identifier}
              plugin={plugin}
              getIconUrl={getIconUrl}
              language={language}
              statusIcon={
                <span className="i-ri-loader-2-line size-3.5 animate-spin text-text-accent" />
              }
              statusText={plugin.message || t('task.installingHint', { ns: 'plugin' })}
            />
          ))}
        </>
      )}
    </div>
  )
}

export default PluginTaskList
