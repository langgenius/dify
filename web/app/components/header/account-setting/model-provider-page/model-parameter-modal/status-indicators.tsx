import { RiErrorWarningFill } from '@remixicon/react'
import Link from 'next/link'
import Tooltip from '@/app/components/base/tooltip'
import { SwitchPluginVersion } from '@/app/components/workflow/nodes/_base/components/switch-plugin-version'
import { useInstalledPluginList } from '@/service/use-plugins'

type StatusIndicatorsProps = {
  needsConfiguration: boolean
  modelProvider: boolean
  inModelList: boolean
  disabled: boolean
  pluginInfo: any
  t: any
}

const StatusIndicators = ({ needsConfiguration, modelProvider, inModelList, disabled, pluginInfo, t }: StatusIndicatorsProps) => {
  const { data: pluginList } = useInstalledPluginList()
  const renderTooltipContent = (title: string, description?: string, linkText?: string, linkHref?: string) => {
    return (
      <div className="flex w-[240px] max-w-[240px] flex-col gap-1 px-1 py-1.5" onClick={e => e.stopPropagation()}>
        <div className="title-xs-semi-bold text-text-primary">{title}</div>
        {description && (
          <div className="body-xs-regular min-w-[200px] text-text-secondary">
            {description}
          </div>
        )}
        {linkText && linkHref && (
          <div className="body-xs-regular z-[100] cursor-pointer text-text-accent">
            <Link
              href={linkHref}
              onClick={(e) => {
                e.stopPropagation()
              }}
            >
              {linkText}
            </Link>
          </div>
        )}
      </div>
    )
  }
  // const installedPluginUniqueIdentifier = pluginList?.plugins.find(plugin => plugin.name === pluginInfo.name)?.plugin_unique_identifier
  return (
    <>
      {/* plugin installed and model is in model list but disabled */}
      {/* plugin installed from github/local and model is not in model list */}
      {!needsConfiguration && modelProvider && disabled && (
        <>
          {inModelList
            ? (
                <Tooltip
                  popupContent={t('nodes.agent.modelSelectorTooltips.deprecated', { ns: 'workflow' })}
                  asChild={false}
                  needsDelay={false}
                >
                  <RiErrorWarningFill className="h-4 w-4 text-text-destructive" />
                </Tooltip>
              )
            : !pluginInfo
                ? (
                    <Tooltip
                      popupContent={renderTooltipContent(
                        t('nodes.agent.modelNotSupport.title', { ns: 'workflow' }),
                        t('nodes.agent.modelNotSupport.desc', { ns: 'workflow' }),
                        t('nodes.agent.linkToPlugin', { ns: 'workflow' }),
                        '/plugins',
                      )}
                      asChild={false}
                    >
                      <RiErrorWarningFill className="h-4 w-4 text-text-destructive" />
                    </Tooltip>
                  )
                : (
                    <SwitchPluginVersion
                      tooltip={renderTooltipContent(
                        t('nodes.agent.modelNotSupport.title', { ns: 'workflow' }),
                        t('nodes.agent.modelNotSupport.descForVersionSwitch', { ns: 'workflow' }),
                      )}
                      uniqueIdentifier={pluginList?.plugins.find(plugin => plugin.name === pluginInfo.name)?.plugin_unique_identifier ?? ''}
                    />
                  )}
        </>
      )}
      {!modelProvider && !pluginInfo && (
        <Tooltip
          popupContent={renderTooltipContent(
            t('nodes.agent.modelNotInMarketplace.title', { ns: 'workflow' }),
            t('nodes.agent.modelNotInMarketplace.desc', { ns: 'workflow' }),
            t('nodes.agent.linkToPlugin', { ns: 'workflow' }),
            '/plugins',
          )}
          asChild={false}
        >
          <RiErrorWarningFill className="h-4 w-4 text-text-destructive" />
        </Tooltip>
      )}
    </>
  )
}

export default StatusIndicators
