import type { ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiErrorWarningFill } from '@remixicon/react'
import { SwitchPluginVersion } from '@/app/components/workflow/nodes/_base/components/switch-plugin-version'
import Link from '@/next/link'
import { useInstalledPluginList } from '@/service/use-plugins'

type StatusIndicatorsProps = {
  needsConfiguration: boolean
  modelProvider: boolean
  inModelList: boolean
  disabled: boolean
  pluginInfo: any
  t: any
}

type StatusPopoverProps = {
  ariaLabel: string
  content: ReactNode
  children: ReactNode
}

const StatusPopover = ({ ariaLabel, content, children }: StatusPopoverProps) => (
  <Popover>
    <PopoverTrigger
      openOnHover
      aria-label={ariaLabel}
      className="inline-flex border-0 bg-transparent p-0"
      onClick={e => e.stopPropagation()}
    >
      {children}
    </PopoverTrigger>
    <PopoverContent placement="top" popupClassName="rounded-md px-3 py-2 system-xs-regular text-text-tertiary">
      {content}
    </PopoverContent>
  </Popover>
)

const StatusIndicators = ({ needsConfiguration, modelProvider, inModelList, disabled, pluginInfo, t }: StatusIndicatorsProps) => {
  const { data: pluginList } = useInstalledPluginList()
  const renderTooltipContent = (title: string, description?: string, linkText?: string, linkHref?: string) => {
    return (
      <div className="flex w-[240px] max-w-[240px] flex-col gap-1 px-1 py-1.5" onClick={e => e.stopPropagation()}>
        <div className="title-xs-semi-bold text-text-primary">{title}</div>
        {description && (
          <div className="min-w-[200px] body-xs-regular text-text-secondary">
            {description}
          </div>
        )}
        {linkText && linkHref && (
          <div className="z-100 cursor-pointer body-xs-regular text-text-accent">
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
                <StatusPopover
                  ariaLabel={t('nodes.agent.modelSelectorTooltips.deprecated', { ns: 'workflow' })}
                  content={t('nodes.agent.modelSelectorTooltips.deprecated', { ns: 'workflow' })}
                >
                  <RiErrorWarningFill className="h-4 w-4 text-text-destructive" />
                </StatusPopover>
              )
            : !pluginInfo
                ? (
                    <StatusPopover
                      ariaLabel={t('nodes.agent.modelNotSupport.title', { ns: 'workflow' })}
                      content={renderTooltipContent(
                        t('nodes.agent.modelNotSupport.title', { ns: 'workflow' }),
                        t('nodes.agent.modelNotSupport.desc', { ns: 'workflow' }),
                        t('nodes.agent.linkToPlugin', { ns: 'workflow' }),
                        '/plugins',
                      )}
                    >
                      <RiErrorWarningFill className="h-4 w-4 text-text-destructive" />
                    </StatusPopover>
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
        <StatusPopover
          ariaLabel={t('nodes.agent.modelNotInMarketplace.title', { ns: 'workflow' })}
          content={renderTooltipContent(
            t('nodes.agent.modelNotInMarketplace.title', { ns: 'workflow' }),
            t('nodes.agent.modelNotInMarketplace.desc', { ns: 'workflow' }),
            t('nodes.agent.linkToPlugin', { ns: 'workflow' }),
            '/plugins',
          )}
        >
          <RiErrorWarningFill className="h-4 w-4 text-text-destructive" />
        </StatusPopover>
      )}
    </>
  )
}

export default StatusIndicators
