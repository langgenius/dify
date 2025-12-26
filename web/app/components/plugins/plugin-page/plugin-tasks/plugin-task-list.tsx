import type { ReactNode } from 'react'
import type { PluginStatus } from '@/app/components/plugins/types'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoaderLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import CardIcon from '@/app/components/plugins/card/base/card-icon'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import { useGetLanguage } from '@/context/i18n'

// Plugin item base component
type PluginTaskItemProps = {
  plugin: PluginStatus
  statusIcon: ReactNode
  statusText: string
  statusClassName?: string
  action?: ReactNode
}

const PluginTaskItem = ({
  plugin,
  statusIcon,
  statusText,
  statusClassName = 'text-text-tertiary',
  action,
}: PluginTaskItemProps) => {
  const language = useGetLanguage()
  const { getIconUrl } = useGetIcon()

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
        <div className={`system-xs-regular ${statusClassName}`}>
          {statusText}
        </div>
      </div>
      {action}
    </div>
  )
}

// Section header component
type SectionHeaderProps = {
  title: string
  count: number
  action?: ReactNode
}

const SectionHeader = ({ title, count, action }: SectionHeaderProps) => (
  <div className="system-sm-semibold-uppercase sticky top-0 flex h-7 items-center justify-between px-2 pt-1 text-text-secondary">
    {title}
    {' '}
    (
    {count}
    )
    {action}
  </div>
)

// Running plugins section
type RunningPluginsSectionProps = {
  plugins: PluginStatus[]
}

export const RunningPluginsSection = ({ plugins }: RunningPluginsSectionProps) => {
  const { t } = useTranslation()

  if (plugins.length === 0)
    return null

  return (
    <>
      <SectionHeader title={t('plugin.task.installing')} count={plugins.length} />
      <div className="max-h-[200px] overflow-y-auto">
        {plugins.map(plugin => (
          <PluginTaskItem
            key={plugin.plugin_unique_identifier}
            plugin={plugin}
            statusIcon={
              <RiLoaderLine className="absolute -bottom-0.5 -right-0.5 z-10 h-3 w-3 animate-spin text-text-accent" />
            }
            statusText={t('plugin.task.installing')}
          />
        ))}
      </div>
    </>
  )
}

// Success plugins section
type SuccessPluginsSectionProps = {
  plugins: PluginStatus[]
  onClearAll: () => void
}

export const SuccessPluginsSection = ({ plugins, onClearAll }: SuccessPluginsSectionProps) => {
  const { t } = useTranslation()

  if (plugins.length === 0)
    return null

  return (
    <>
      <SectionHeader
        title={t('plugin.task.installed')}
        count={plugins.length}
        action={(
          <Button
            className="shrink-0"
            size="small"
            variant="ghost"
            onClick={onClearAll}
          >
            {t('plugin.task.clearAll')}
          </Button>
        )}
      />
      <div className="max-h-[200px] overflow-y-auto">
        {plugins.map(plugin => (
          <PluginTaskItem
            key={plugin.plugin_unique_identifier}
            plugin={plugin}
            statusIcon={
              <RiCheckboxCircleFill className="absolute -bottom-0.5 -right-0.5 z-10 h-3 w-3 text-text-success" />
            }
            statusText={plugin.message || t('plugin.task.installed')}
            statusClassName="text-text-success"
          />
        ))}
      </div>
    </>
  )
}

// Error plugins section
type ErrorPluginsSectionProps = {
  plugins: PluginStatus[]
  onClearAll: () => void
  onClearSingle: (taskId: string, pluginId: string) => void
}

export const ErrorPluginsSection = ({ plugins, onClearAll, onClearSingle }: ErrorPluginsSectionProps) => {
  const { t } = useTranslation()

  if (plugins.length === 0)
    return null

  return (
    <>
      <SectionHeader
        title={t('plugin.task.installError', { errorLength: plugins.length })}
        count={plugins.length}
        action={(
          <Button
            className="shrink-0"
            size="small"
            variant="ghost"
            onClick={onClearAll}
          >
            {t('plugin.task.clearAll')}
          </Button>
        )}
      />
      <div className="max-h-[200px] overflow-y-auto">
        {plugins.map(plugin => (
          <PluginTaskItem
            key={plugin.plugin_unique_identifier}
            plugin={plugin}
            statusIcon={
              <RiErrorWarningFill className="absolute -bottom-0.5 -right-0.5 z-10 h-3 w-3 text-text-destructive" />
            }
            statusText={plugin.message}
            statusClassName="break-all text-text-destructive"
            action={(
              <Button
                className="shrink-0"
                size="small"
                variant="ghost"
                onClick={() => onClearSingle(plugin.taskId, plugin.plugin_unique_identifier)}
              >
                {t('common.operation.clear')}
              </Button>
            )}
          />
        ))}
      </div>
    </>
  )
}
