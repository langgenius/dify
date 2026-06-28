import type { PluginStatus } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'
import { useGetLanguage } from '@/context/i18n'
import ErrorPluginItem from './error-plugin-item'
import PluginSection from './plugin-section'

type PluginTaskListProps = {
  runningPlugins: PluginStatus[]
  successPlugins: PluginStatus[]
  errorPlugins: PluginStatus[]
  getIconUrl: (icon: string) => string
  onClearAll: () => void
  onClearErrors: () => void
  onClearSingle: (taskId: string, pluginId: string) => void
}

function PluginTaskList({
  runningPlugins,
  successPlugins,
  errorPlugins,
  getIconUrl,
  onClearAll,
  onClearErrors,
  onClearSingle,
}: PluginTaskListProps) {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const runningSectionTitle = t('task.runningPlugins', { ns: 'plugin' })
  const successSectionTitle = t('task.successPlugins', { ns: 'plugin' })
  const errorSectionTitle = t('task.errorPlugins', { ns: 'plugin' })

  return (
    <div
      className="w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg"
      data-testid="plugin-task-list"
    >
      <ScrollArea
        className="max-h-[420px] overflow-hidden"
        label={t('task.installing', { ns: 'plugin' })}
        slotClassNames={{
          viewport: 'max-h-[420px] overscroll-contain',
          content: 'w-full! max-w-full! min-w-0! overflow-x-hidden!',
        }}
      >
        {runningPlugins.length > 0 && (
          <PluginSection
            title={runningSectionTitle}
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

        {successPlugins.length > 0 && (
          <PluginSection
            title={successSectionTitle}
            count={successPlugins.length}
            plugins={successPlugins}
            getIconUrl={getIconUrl}
            language={language}
            statusIcon={
              <span className="i-ri-checkbox-circle-fill size-3.5 text-text-success" />
            }
            defaultStatusText={t('task.installed', { ns: 'plugin' })}
            statusClassName="text-text-success"
            headerAction={(
              <Button
                aria-label={`${successSectionTitle} ${t('task.clearAll', { ns: 'plugin' })}`}
                className="shrink-0"
                size="small"
                variant="ghost"
                onClick={onClearAll}
              >
                {t('task.clearAll', { ns: 'plugin' })}
              </Button>
            )}
            onClearSingle={onClearSingle}
          />
        )}

        {errorPlugins.length > 0 && (
          <>
            <div className="sticky top-0 flex h-7 items-center justify-between px-2 pt-1 system-sm-semibold-uppercase text-text-secondary">
              {errorSectionTitle}
              {' '}
              (
              {errorPlugins.length}
              )
              <Button
                aria-label={`${errorSectionTitle} ${t('task.clearAll', { ns: 'plugin' })}`}
                className="shrink-0"
                size="small"
                variant="ghost"
                onClick={onClearErrors}
              >
                {t('task.clearAll', { ns: 'plugin' })}
              </Button>
            </div>
            <div
              aria-label={errorSectionTitle}
              className="w-full max-w-full min-w-0 overflow-hidden"
              role="region"
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
            </div>
          </>
        )}
      </ScrollArea>
    </div>
  )
}

export default PluginTaskList
