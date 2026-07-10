import type { Placement } from '@langgenius/dify-ui/dropdown-menu'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import PluginTaskList from './components/plugin-task-list'
import TaskStatusIndicator from './components/task-status-indicator'
import { usePluginTaskStatus } from './hooks'

type PluginTasksProps = {
  animatedSlot?: boolean
  dropdownAnchor?: () => Element | null
  dropdownPlacement?: Placement
}

const PluginTasks = ({
  animatedSlot = false,
  dropdownAnchor,
  dropdownPlacement = 'bottom',
}: PluginTasksProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    errorPlugins,
    successPlugins,
    runningPlugins,
    runningPluginsLength,
    successPluginsLength,
    errorPluginsLength,
    totalPluginsLength,
    isInstalling,
    isInstallingWithSuccess,
    isInstallingWithError,
    isSuccess,
    isFailed,
    handleClearErrorPlugin,
  } = usePluginTaskStatus()
  const { getIconUrl } = useGetIcon()
  const hasPluginTasks = totalPluginsLength > 0
  const canOpenMenu = isFailed || isInstalling || isInstallingWithSuccess || isInstallingWithError || isSuccess

  // Generate tooltip text based on status
  const tip = useMemo(() => {
    if (isInstallingWithError)
      return t($ => $['task.installingWithError'], { ns: 'plugin', installingLength: runningPluginsLength, successLength: successPluginsLength, errorLength: errorPluginsLength })
    if (isInstallingWithSuccess)
      return t($ => $['task.installingWithSuccess'], { ns: 'plugin', installingLength: runningPluginsLength, successLength: successPluginsLength })
    if (isInstalling)
      return t($ => $['task.installing'], { ns: 'plugin' })
    if (isFailed)
      return t($ => $['task.installedError'], { ns: 'plugin', errorLength: errorPluginsLength })
    if (isSuccess)
      return t($ => $['task.installSuccess'], { ns: 'plugin', successLength: successPluginsLength })
    return t($ => $['task.installed'], { ns: 'plugin' })
  }, [
    errorPluginsLength,
    isFailed,
    isInstalling,
    isInstallingWithError,
    isInstallingWithSuccess,
    isSuccess,
    runningPluginsLength,
    successPluginsLength,
    t,
  ])

  // Generic clear function that handles clearing and modal closing
  const clearPluginsAndClose = useCallback(async (
    plugins: Array<{ taskId: string, plugin_unique_identifier: string }>,
  ) => {
    for (const plugin of plugins)
      await handleClearErrorPlugin(plugin.taskId, plugin.plugin_unique_identifier)
    if (runningPluginsLength === 0)
      setOpen(false)
  }, [handleClearErrorPlugin, runningPluginsLength])

  // Clear handlers using the generic function
  const handleClearAll = useCallback(
    () => clearPluginsAndClose([...successPlugins, ...errorPlugins]),
    [clearPluginsAndClose, successPlugins, errorPlugins],
  )

  const handleClearErrors = useCallback(
    () => clearPluginsAndClose(errorPlugins),
    [clearPluginsAndClose, errorPlugins],
  )

  const handleClearSingle = useCallback(
    (taskId: string, pluginId: string) => clearPluginsAndClose([{ taskId, plugin_unique_identifier: pluginId }]),
    [clearPluginsAndClose],
  )

  const rootClassName = animatedSlot
    ? cn(
        'flex shrink-0 items-center overflow-visible transition-[width,margin-left,opacity] duration-200 ease-out',
        hasPluginTasks ? 'ml-1 w-8 opacity-100' : 'ml-0 w-0 opacity-0',
      )
    : 'flex items-center'

  if (!hasPluginTasks) {
    if (animatedSlot)
      return <div aria-hidden className={rootClassName} />
    return null
  }

  return (
    <div className={rootClassName}>
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
      >
        <DropdownMenuTrigger
          nativeButton={false}
          render={<div className={canOpenMenu ? 'cursor-pointer' : 'cursor-default'} />}
          disabled={!canOpenMenu}
        >
          <TaskStatusIndicator
            tip={tip}
            isInstalling={isInstalling}
            isInstallingWithSuccess={isInstallingWithSuccess}
            isInstallingWithError={isInstallingWithError}
            isSuccess={isSuccess}
            isFailed={isFailed}
            isOpen={open}
            successPluginsLength={successPluginsLength}
            runningPluginsLength={runningPluginsLength}
            totalPluginsLength={totalPluginsLength}
            onClick={() => {}}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement={dropdownPlacement}
          sideOffset={4}
          positionerProps={dropdownAnchor ? { anchor: dropdownAnchor } : undefined}
          popupClassName="overflow-visible border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
        >
          <PluginTaskList
            runningPlugins={runningPlugins}
            successPlugins={successPlugins}
            errorPlugins={errorPlugins}
            getIconUrl={getIconUrl}
            onClearAll={handleClearAll}
            onClearErrors={handleClearErrors}
            onClearSingle={handleClearSingle}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default PluginTasks
