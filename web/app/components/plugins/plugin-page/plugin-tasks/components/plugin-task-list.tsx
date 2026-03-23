import type { FC } from 'react'
import type { PluginStatus } from '@/app/components/plugins/types'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
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

const PluginTaskList: FC<PluginTaskListProps> = ({
  runningPlugins,
  successPlugins,
  errorPlugins,
  getIconUrl,
  onClearAll,
  onClearErrors,
  onClearSingle,
}) => {
  const { t } = useTranslation()
  const language = useGetLanguage()

  return (
    <div className="w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
      {/* Running Plugins Section */}
      {runningPlugins.length > 0 && (
        <PluginSection
          title={t('task.installing', { ns: 'plugin' })}
          count={runningPlugins.length}
          plugins={runningPlugins}
          getIconUrl={getIconUrl}
          language={language}
          statusIcon={
            <span className="i-ri-loader-2-line h-3.5 w-3.5 animate-spin text-text-accent" />
          }
          defaultStatusText={t('task.installingHint', { ns: 'plugin' })}
        />
      )}

      {/* Success Plugins Section */}
      {successPlugins.length > 0 && (
        <PluginSection
          title={t('task.installed', { ns: 'plugin' })}
          count={successPlugins.length}
          plugins={successPlugins}
          getIconUrl={getIconUrl}
          language={language}
          statusIcon={
            <span className="i-ri-checkbox-circle-fill h-3.5 w-3.5 text-text-success" />
          }
          defaultStatusText={t('task.installed', { ns: 'plugin' })}
          statusClassName="text-text-success"
          headerAction={(
            <Button
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

      {/* Error Plugins Section */}
      {errorPlugins.length > 0 && (
        <>
          <div className="sticky top-0 flex h-7 items-center justify-between px-2 pt-1 text-text-secondary system-sm-semibold-uppercase">
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
          <div className="max-h-[300px] overflow-y-auto">
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
    </div>
  )
}

export default PluginTaskList
