import type { ReactNode } from 'react'
import type { ToolWithProvider } from '../../../types'
import type { Strategy } from './agent-strategy'
import type { StrategyPluginDetail } from '@/app/components/plugins/types'
import type { ListProps, ListRef } from '@/app/components/workflow/block-selector/market-place-plugin/list'
import { RiArrowDownSLine, RiErrorWarningFill } from '@remixicon/react'
import Link from 'next/link'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import SearchInput from '@/app/components/base/search-input'
import Tooltip from '@/app/components/base/tooltip'
import { ToolTipContent } from '@/app/components/base/tooltip/content'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/hooks'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import PluginList from '@/app/components/workflow/block-selector/market-place-plugin/list'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useStrategyProviders } from '@/service/use-strategy'
import { cn } from '@/utils/classnames'
import Tools from '../../../block-selector/tools'
import ViewTypeSelect, { ViewType } from '../../../block-selector/view-type-select'
import { useStrategyInfo } from '../../agent/use-config'
import { InstallPluginButton } from './install-plugin-button'
import { SwitchPluginVersion } from './switch-plugin-version'

const DEFAULT_TAGS: ListProps['tags'] = []

const NotFoundWarn = (props: {
  title: ReactNode
  description: ReactNode
}) => {
  const { title, description } = props

  const { t } = useTranslation()
  return (
    <Tooltip
      popupContent={(
        <div className="space-y-1 text-xs">
          <h3 className="font-semibold text-text-primary">
            {title}
          </h3>
          <p className="tracking-tight text-text-secondary">
            {description}
          </p>
          <p>
            <Link href="/plugins" className="tracking-tight text-text-accent">
              {t('nodes.agent.linkToPlugin', { ns: 'workflow' })}
            </Link>
          </p>
        </div>
      )}
    >
      <div>
        <RiErrorWarningFill className="size-4 text-text-destructive" />
      </div>
    </Tooltip>
  )
}

function formatStrategy(input: StrategyPluginDetail[], getIcon: (i: string) => string): ToolWithProvider[] {
  return input.map((item) => {
    const res: ToolWithProvider = {
      id: item.plugin_unique_identifier,
      author: item.declaration.identity.author,
      name: item.declaration.identity.name,
      description: item.declaration.identity.description as any,
      plugin_id: item.plugin_id,
      icon: getIcon(item.declaration.identity.icon),
      label: item.declaration.identity.label as any,
      type: CollectionType.all,
      meta: item.meta,
      tools: item.declaration.strategies.map(strategy => ({
        name: strategy.identity.name,
        author: strategy.identity.author,
        label: strategy.identity.label as any,
        description: strategy.description,
        parameters: strategy.parameters as any,
        output_schema: strategy.output_schema,
        labels: [],
      })),
      team_credentials: {},
      is_team_authorization: true,
      allow_delete: false,
      labels: [],
    }
    return res
  })
}

export type AgentStrategySelectorProps = {
  value?: Strategy
  onChange: (value?: Strategy) => void
}

export const AgentStrategySelector = memo((props: AgentStrategySelectorProps) => {
  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)

  const { value, onChange } = props
  const [open, setOpen] = useState(false)
  const [viewType, setViewType] = useState<ViewType>(ViewType.flat)
  const [query, setQuery] = useState('')
  const stra = useStrategyProviders()
  const { getIconUrl } = useGetIcon()
  const list = stra.data ? formatStrategy(stra.data, getIconUrl) : undefined
  const filteredTools = useMemo(() => {
    if (!list)
      return []
    return list.filter(tool => tool.name.toLowerCase().includes(query.toLowerCase()))
  }, [query, list])
  const { strategyStatus, refetch: refetchStrategyInfo } = useStrategyInfo(
    value?.agent_strategy_provider_name,
    value?.agent_strategy_name,
  )

  const showPluginNotInstalledWarn = strategyStatus?.plugin?.source === 'external'
    && !strategyStatus.plugin.installed && !!value

  const showUnsupportedStrategy = strategyStatus?.plugin.source === 'external'
    && !strategyStatus?.isExistInPlugin && !!value

  const showSwitchVersion = !strategyStatus?.isExistInPlugin
    && strategyStatus?.plugin.source === 'marketplace' && strategyStatus.plugin.installed && !!value

  const showInstallButton = !strategyStatus?.isExistInPlugin
    && strategyStatus?.plugin.source === 'marketplace' && !strategyStatus.plugin.installed && !!value

  const icon = list?.find(
    coll => coll.tools?.find(tool => tool.name === value?.agent_strategy_name),
  )?.icon as string | undefined
  const { t } = useTranslation()

  const wrapElemRef = useRef<HTMLDivElement>(null)

  const {
    queryPluginsWithDebounced: fetchPlugins,
    plugins: notInstalledPlugins = [],
  } = useMarketplacePlugins()

  useEffect(() => {
    if (!enable_marketplace)
      return
    if (query) {
      fetchPlugins({
        query,
        category: PluginCategoryEnum.agent,
      })
    }
  }, [query])

  const pluginRef = useRef<ListRef>(null)

  return (
    <PortalToFollowElem open={open} onOpenChange={setOpen} placement="bottom">
      <PortalToFollowElemTrigger className="w-full">
        <div
          className="flex h-8 w-full select-none items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 hover:bg-state-base-hover-alt"
          onClick={() => setOpen(o => !o)}
        >
          { }
          {icon && (
            <div className="flex h-6 w-6 items-center justify-center">
              <img
                src={icon}
                width={20}
                height={20}
                className="rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge"
                alt="icon"
              />
            </div>
          )}
          <p
            className={cn(value ? 'text-components-input-text-filled' : 'text-components-input-text-placeholder', 'px-1 text-xs')}
          >
            {value?.agent_strategy_label || t('nodes.agent.strategy.selectTip', { ns: 'workflow' })}
          </p>
          <div className="ml-auto flex items-center gap-1">
            {showInstallButton && value && (
              <InstallPluginButton
                onClick={e => e.stopPropagation()}
                size="small"
                uniqueIdentifier={value.plugin_unique_identifier}
              />
            )}
            {showPluginNotInstalledWarn
              ? (
                  <NotFoundWarn
                    title={t('nodes.agent.pluginNotInstalled', { ns: 'workflow' })}
                    description={t('nodes.agent.pluginNotInstalledDesc', { ns: 'workflow' })}
                  />
                )
              : showUnsupportedStrategy
                ? (
                    <NotFoundWarn
                      title={t('nodes.agent.unsupportedStrategy', { ns: 'workflow' })}
                      description={t('nodes.agent.strategyNotFoundDesc', { ns: 'workflow' })}
                    />
                  )
                : <RiArrowDownSLine className="size-4 text-text-tertiary" />}
            {showSwitchVersion && (
              <SwitchPluginVersion
                uniqueIdentifier={value.plugin_unique_identifier}
                tooltip={(
                  <ToolTipContent
                    title={t('nodes.agent.unsupportedStrategy', { ns: 'workflow' })}
                  >
                    {t('nodes.agent.strategyNotFoundDescAndSwitchVersion', { ns: 'workflow' })}
                  </ToolTipContent>
                )}
                onChange={() => {
                  refetchStrategyInfo()
                }}
              />
            )}
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-10">
        <div className="w-[388px] overflow-hidden rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow">
          <header className="flex gap-1 p-2">
            <SearchInput placeholder={t('nodes.agent.strategy.searchPlaceholder', { ns: 'workflow' })} value={query} onChange={setQuery} className="w-full" />
            <ViewTypeSelect viewType={viewType} onChange={setViewType} />
          </header>
          <main className="relative flex w-full flex-col overflow-hidden md:max-h-[300px] xl:max-h-[400px] 2xl:max-h-[564px]" ref={wrapElemRef}>
            <Tools
              tools={filteredTools}
              viewType={viewType}
              onSelect={(_, tool) => {
                onChange({
                  agent_strategy_name: tool!.tool_name,
                  agent_strategy_provider_name: tool!.provider_name,
                  agent_strategy_label: tool!.tool_label,
                  agent_output_schema: tool!.output_schema || {},
                  plugin_unique_identifier: tool!.provider_id,
                  meta: tool!.meta,
                })
                setOpen(false)
              }}
              className="h-full max-h-full max-w-none overflow-y-auto"
              indexBarClassName="top-0 xl:top-36"
              hasSearchText={false}
              canNotSelectMultiple
              isAgent
            />
            {enable_marketplace && (
              <PluginList
                ref={pluginRef}
                wrapElemRef={wrapElemRef}
                list={notInstalledPlugins}
                searchText={query}
                tags={DEFAULT_TAGS}
                category={PluginCategoryEnum.agent}
                disableMaxWidth
              />
            )}
          </main>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
})

AgentStrategySelector.displayName = 'AgentStrategySelector'
