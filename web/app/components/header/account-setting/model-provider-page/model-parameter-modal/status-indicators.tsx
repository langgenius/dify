import Tooltip from '@/app/components/base/tooltip'
import Link from 'next/link'
import { SwitchPluginVersion } from '@/app/components/workflow/nodes/_base/components/switch-plugin-version'
import { useInstalledPluginList } from '@/service/use-plugins'
import { RiErrorWarningFill } from '@remixicon/react'

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
      <div className='flex w-[240px] max-w-[240px] gap-1 flex-col px-1 py-1.5' onClick={e => e.stopPropagation()}>
        <div className='text-text-primary title-xs-semi-bold'>{title}</div>
        {description && (
          <div className='min-w-[200px] text-text-secondary body-xs-regular'>
            {description}
          </div>
        )}
        {linkText && linkHref && (
          <div className='text-text-accent body-xs-regular cursor-pointer z-[100]'>
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
          {inModelList ? (
            <Tooltip
              popupContent={t('workflow.nodes.agent.modelSelectorTooltips.deprecated')}
              asChild={false}
              needsDelay={false}
            >
              <RiErrorWarningFill className='w-4 h-4 text-text-destructive' />
            </Tooltip>
          ) : !pluginInfo ? (
            <Tooltip
              popupContent={renderTooltipContent(
                t('workflow.nodes.agent.modelNotSupport.title'),
                t('workflow.nodes.agent.modelNotSupport.desc'),
                t('workflow.nodes.agent.linkToPlugin'),
                '/plugins',
              )}
              asChild={false}
              needsDelay={true}
            >
              <RiErrorWarningFill className='w-4 h-4 text-text-destructive' />
            </Tooltip>
          ) : (
            <SwitchPluginVersion
              tooltip={renderTooltipContent(
                t('workflow.nodes.agent.modelNotSupport.title'),
                t('workflow.nodes.agent.modelNotSupport.descForVersionSwitch'),
              )}
              uniqueIdentifier={pluginList?.plugins.find(plugin => plugin.name === pluginInfo.name)?.plugin_unique_identifier ?? ''}
            />
          )}
        </>
      )}
      {!modelProvider && !pluginInfo && (
        <Tooltip
          popupContent={renderTooltipContent(
            t('workflow.nodes.agent.modelNotInMarketplace.title'),
            t('workflow.nodes.agent.modelNotInMarketplace.desc'),
            t('workflow.nodes.agent.linkToPlugin'),
            '/plugins',
          )}
          asChild={false}
          needsDelay
        >
          <RiErrorWarningFill className='w-4 h-4 text-text-destructive' />
        </Tooltip>
      )}
    </>
  )
}

export default StatusIndicators
