import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import {
  ErrorPluginsSection,
  RunningPluginsSection,
  SuccessPluginsSection,
} from './plugin-task-list'
import PluginTaskTrigger from './plugin-task-trigger'
import { usePluginTaskPanel } from './use-plugin-task-panel'

const PluginTasks = () => {
  const {
    open,
    setOpen,
    tip,
    taskStatus,
    handleClearAll,
    handleClearErrors,
    handleClearSingle,
  } = usePluginTaskPanel()

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
  } = taskStatus

  // Show icon if there are any plugin tasks (completed, running, or failed)
  // Only hide when there are absolutely no plugin tasks
  if (totalPluginsLength === 0)
    return null

  const canOpenPanel = isFailed || isInstalling || isInstallingWithSuccess || isInstallingWithError || isSuccess

  return (
    <div className="flex items-center">
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement="bottom-start"
        offset={{
          mainAxis: 4,
          crossAxis: 79,
        }}
      >
        <PortalToFollowElemTrigger
          onClick={() => {
            if (canOpenPanel)
              setOpen(!open)
          }}
        >
          <PluginTaskTrigger
            tip={tip}
            isInstalling={isInstalling}
            isInstallingWithSuccess={isInstallingWithSuccess}
            isInstallingWithError={isInstallingWithError}
            isSuccess={isSuccess}
            isFailed={isFailed}
            successPluginsLength={successPluginsLength}
            runningPluginsLength={runningPluginsLength}
            errorPluginsLength={errorPluginsLength}
            totalPluginsLength={totalPluginsLength}
          />
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[11]">
          <div className="w-[360px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
            <RunningPluginsSection plugins={runningPlugins} />
            <SuccessPluginsSection plugins={successPlugins} onClearAll={handleClearAll} />
            <ErrorPluginsSection
              plugins={errorPlugins}
              onClearAll={handleClearErrors}
              onClearSingle={handleClearSingle}
            />
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default PluginTasks
