import type { FC, ReactNode } from 'react'
import type { PluginStatus } from '@/app/components/plugins/types'
import type { Locale } from '@/i18n-config'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoaderLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import CardIcon from '@/app/components/plugins/card/base/card-icon'
import { useGetLanguage } from '@/context/i18n'

// Types
type PluginItemProps = {
  plugin: PluginStatus
  getIconUrl: (icon: string) => string
  language: Locale
  statusIcon: ReactNode
  statusText: string
  statusClassName?: string
  action?: ReactNode
}

type PluginSectionProps = {
  title: string
  count: number
  plugins: PluginStatus[]
  getIconUrl: (icon: string) => string
  language: Locale
  statusIcon: ReactNode
  defaultStatusText: string
  statusClassName?: string
  headerAction?: ReactNode
  renderItemAction?: (plugin: PluginStatus) => ReactNode
}

type PluginTaskListProps = {
  runningPlugins: PluginStatus[]
  successPlugins: PluginStatus[]
  errorPlugins: PluginStatus[]
  getIconUrl: (icon: string) => string
  onClearAll: () => void
  onClearErrors: () => void
  onClearSingle: (taskId: string, pluginId: string) => void
}

// Plugin Item Component
const PluginItem: FC<PluginItemProps> = ({
  plugin,
  getIconUrl,
  language,
  statusIcon,
  statusText,
  statusClassName,
  action,
}) => {
  return (
    <div className="flex items-center rounded-lg p-2 hover:bg-state-base-hover">
      <div className="relative mr-2 flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge">
        {statusIcon}
        <CardIcon
          size="tiny"
          src={getIconUrl(plugin.icon)}
        />
      </div>
      <div className="grow">
        <div className="system-md-regular truncate text-text-secondary">
          {plugin.labels[language]}
        </div>
        <div className={`system-xs-regular ${statusClassName || 'text-text-tertiary'}`}>
          {statusText}
        </div>
      </div>
      {action}
    </div>
  )
}

// Plugin Section Component
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
}) => {
  if (plugins.length === 0)
    return null

  return (
    <>
      <div className="system-sm-semibold-uppercase sticky top-0 flex h-7 items-center justify-between px-2 pt-1 text-text-secondary">
        {title}
        {' '}
        (
        {count}
        )
        {headerAction}
      </div>
      <div className="max-h-[200px] overflow-y-auto">
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
          />
        ))}
      </div>
    </>
  )
}

// Main Plugin Task List Component
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
            <RiLoaderLine className="absolute -bottom-0.5 -right-0.5 z-10 h-3 w-3 animate-spin text-text-accent" />
          }
          defaultStatusText={t('task.installing', { ns: 'plugin' })}
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
            <RiCheckboxCircleFill className="absolute -bottom-0.5 -right-0.5 z-10 h-3 w-3 text-text-success" />
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
        />
      )}

      {/* Error Plugins Section */}
      {errorPlugins.length > 0 && (
        <PluginSection
          title={t('task.installError', { ns: 'plugin', errorLength: errorPlugins.length })}
          count={errorPlugins.length}
          plugins={errorPlugins}
          getIconUrl={getIconUrl}
          language={language}
          statusIcon={
            <RiErrorWarningFill className="absolute -bottom-0.5 -right-0.5 z-10 h-3 w-3 text-text-destructive" />
          }
          defaultStatusText={t('task.installError', { ns: 'plugin', errorLength: errorPlugins.length })}
          statusClassName="text-text-destructive break-all"
          headerAction={(
            <Button
              className="shrink-0"
              size="small"
              variant="ghost"
              onClick={onClearErrors}
            >
              {t('task.clearAll', { ns: 'plugin' })}
            </Button>
          )}
          renderItemAction={plugin => (
            <Button
              className="shrink-0"
              size="small"
              variant="ghost"
              onClick={() => onClearSingle(plugin.taskId, plugin.plugin_unique_identifier)}
            >
              {t('operation.clear', { ns: 'common' })}
            </Button>
          )}
        />
      )}
    </div>
  )
}

export default PluginTaskList
