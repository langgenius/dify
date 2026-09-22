import type { AgentProviderResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { ToolWithProvider } from '../../../types'
import type { Strategy } from './agent-strategy'
import type {
  ListProps,
  ListRef,
} from '@/app/components/workflow/block-selector/marketplace-plugin/list'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/hooks'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import PluginList from '@/app/components/workflow/block-selector/marketplace-plugin/list'
import { useGetLanguage } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { renderI18nObject } from '@/i18n/metadata'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import Tools from '../../../block-selector/tools'
import { ViewType } from '../../../block-selector/types'
import ViewTypeSelect from '../../../block-selector/view-type-select'
import { useStrategyInfo } from '../../agent/use-config'
import { InstallPluginButton } from './install-plugin-button'
import { SwitchPluginVersion } from './switch-plugin-version'

const DEFAULT_TAGS: ListProps['tags'] = []

const NotFoundWarn = (props: { title: string; description: ReactNode }) => {
  const { title, description } = props
  const titleId = useId()

  const { t } = useTranslation()
  return (
    <Infotip>
      <InfotipTrigger
        aria-label={title}
        iconVariant="warning"
        iconSize="large"
        className="text-text-destructive"
      />
      <InfotipContent aria-labelledby={titleId} className="w-45">
        <div className="space-y-1">
          <h3 id={titleId} className="font-semibold text-text-primary">
            {title}
          </h3>
          <p>{description}</p>
          <p>
            <Link href="/plugins" className="text-text-accent">
              {t(($) => $['nodes.agent.linkToPlugin'], { ns: 'workflow' })}
            </Link>
          </p>
        </div>
      </InfotipContent>
    </Infotip>
  )
}

function formatStrategy(
  input: AgentProviderResponse[],
  language: string,
  getIcon: (i: string) => string,
): ToolWithProvider[] {
  const label = (value: Parameters<typeof renderI18nObject>[0]) => ({
    en_US: renderI18nObject(value, 'en_US'),
    zh_Hans: renderI18nObject(value, 'zh_Hans'),
    [language]: renderI18nObject(value, language),
  })
  return input.map((item) => {
    const res: ToolWithProvider = {
      id: item.plugin_unique_identifier,
      author: item.declaration.identity.author,
      name: item.declaration.identity.name,
      description: label(item.declaration.identity.description),
      plugin_id: item.plugin_id,
      icon: item.declaration.identity.icon ? getIcon(item.declaration.identity.icon) : '',
      label: label(item.declaration.identity.label),
      type: CollectionType.all,
      meta: typeof item.meta.version === 'string' ? { version: item.meta.version } : undefined,
      tools: (item.declaration.strategies ?? []).map((strategy) => ({
        name: strategy.identity.name,
        author: strategy.identity.author,
        label: label(strategy.identity.label),
        description: label(strategy.description),
        parameters: [],
        output_schema: strategy.output_schema ?? {},
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

type AgentStrategySelectorProps = {
  value?: Strategy
  onChange: (value?: Strategy) => void
}

export const AgentStrategySelector = memo((props: AgentStrategySelectorProps) => {
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (s) => s.enable_marketplace,
  })

  const { value, onChange } = props
  const [open, setOpen] = useState(false)
  const [viewType, setViewType] = useState<ViewType>(ViewType.flat)
  const [query, setQuery] = useState('')
  const providers = useQuery(consoleQuery.workspaces.current.agentProviders.get.queryOptions())
  const language = useGetLanguage()
  const { getIconUrl } = useGetIcon()
  const list = providers.data ? formatStrategy(providers.data, language, getIconUrl) : undefined
  const filteredTools = useMemo(() => {
    if (!list) return []
    return list.filter((tool) => tool.name.toLowerCase().includes(query.toLowerCase()))
  }, [query, list])
  const { strategyStatus, refetch: refetchStrategyInfo } = useStrategyInfo(
    value?.agent_strategy_provider_name,
    value?.agent_strategy_name,
  )

  const showPluginNotInstalledWarn =
    strategyStatus?.plugin?.source === 'external' && !strategyStatus.plugin.installed && !!value

  const showUnsupportedStrategy =
    strategyStatus?.plugin.source === 'external' && !strategyStatus?.isExistInPlugin && !!value

  const showSwitchVersion =
    !strategyStatus?.isExistInPlugin &&
    strategyStatus?.plugin.source === 'marketplace' &&
    strategyStatus.plugin.installed &&
    !!value

  const showInstallButton =
    !strategyStatus?.isExistInPlugin &&
    strategyStatus?.plugin.source === 'marketplace' &&
    !strategyStatus.plugin.installed &&
    !!value

  const selectedProvider = providers.data?.find(
    (provider) => provider.declaration.identity.name === value?.agent_strategy_provider_name,
  )
  const icon = selectedProvider?.declaration.identity.icon
    ? getIconUrl(selectedProvider.declaration.identity.icon)
    : undefined
  const { t } = useTranslation()

  const wrapElemRef = useRef<HTMLDivElement>(null)

  const { queryPluginsWithDebounced: fetchPlugins, plugins: notInstalledPlugins = [] } =
    useMarketplacePlugins()

  useEffect(() => {
    if (!enable_marketplace) return
    if (query) {
      fetchPlugins({
        query,
        category: PluginCategoryEnum.agent,
      })
    }
  }, [enable_marketplace, fetchPlugins, query])

  const pluginRef = useRef<ListRef>(null)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <div className="flex h-8 w-full items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 select-none hover:bg-state-base-hover-alt">
            {icon && (
              <div className="flex size-6 items-center justify-center">
                <img
                  src={icon}
                  width={20}
                  height={20}
                  className="rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge"
                  alt=""
                />
              </div>
            )}
            <p
              className={cn(
                value
                  ? 'text-components-input-text-filled'
                  : 'text-components-input-text-placeholder',
                'px-1 text-xs',
              )}
            >
              {value?.agent_strategy_label ||
                t(($) => $['nodes.agent.strategy.selectTip'], { ns: 'workflow' })}
            </p>
            <div className="ml-auto flex items-center gap-1">
              {showInstallButton && value?.plugin_unique_identifier && (
                <InstallPluginButton
                  onClick={(e) => e.stopPropagation()}
                  size="small"
                  uniqueIdentifier={value.plugin_unique_identifier}
                />
              )}
              {showPluginNotInstalledWarn ? (
                <NotFoundWarn
                  title={t(($) => $['nodes.agent.pluginNotInstalled'], { ns: 'workflow' })}
                  description={t(($) => $['nodes.agent.pluginNotInstalledDesc'], {
                    ns: 'workflow',
                  })}
                />
              ) : showUnsupportedStrategy ? (
                <NotFoundWarn
                  title={t(($) => $['nodes.agent.unsupportedStrategy'], { ns: 'workflow' })}
                  description={t(($) => $['nodes.agent.strategyNotFoundDesc'], { ns: 'workflow' })}
                />
              ) : (
                <span
                  className="i-ri-arrow-down-s-line size-4 text-text-tertiary"
                  aria-hidden="true"
                />
              )}
              {showSwitchVersion && value?.plugin_unique_identifier && (
                <SwitchPluginVersion
                  uniqueIdentifier={value.plugin_unique_identifier}
                  tooltip={
                    <div className="w-45 space-y-1 text-xs">
                      <h3 className="font-semibold text-text-primary">
                        {t(($) => $['nodes.agent.unsupportedStrategy'], { ns: 'workflow' })}
                      </h3>
                      <p className="text-text-tertiary">
                        {t(($) => $['nodes.agent.strategyNotFoundDescAndSwitchVersion'], {
                          ns: 'workflow',
                        })}
                      </p>
                    </div>
                  }
                  onChange={() => {
                    refetchStrategyInfo()
                  }}
                />
              )}
            </div>
          </div>
        }
      />
      <PopoverContent
        placement="bottom"
        sideOffset={0}
        className="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <div className="w-97 overflow-hidden rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow">
          <header className="flex gap-1 p-2">
            <SearchInput
              placeholder={t(($) => $['nodes.agent.strategy.searchPlaceholder'], {
                ns: 'workflow',
              })}
              value={query}
              onValueChange={setQuery}
              className="w-full"
            />
            <ViewTypeSelect viewType={viewType} onChange={setViewType} />
          </header>
          <div
            className="relative flex w-full flex-col overflow-hidden md:max-h-75 xl:max-h-100 2xl:max-h-141"
            ref={wrapElemRef}
          >
            <Tools
              tools={filteredTools}
              viewType={viewType}
              onSelect={(_, tool) => {
                const provider = providers.data?.find(
                  (item) => item.declaration.identity.name === tool.provider_name,
                )
                const strategy = provider?.declaration.strategies?.find(
                  (item) => item.identity.name === tool.tool_name,
                )
                if (!provider || !strategy) return
                onChange({
                  agent_strategy_name: strategy.identity.name,
                  agent_strategy_provider_name: provider.declaration.identity.name,
                  agent_strategy_label: renderI18nObject(strategy.identity.label, language),
                  agent_output_schema: strategy.output_schema,
                  plugin_unique_identifier: provider.plugin_unique_identifier,
                  meta: provider.meta,
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
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
})

AgentStrategySelector.displayName = 'AgentStrategySelector'
