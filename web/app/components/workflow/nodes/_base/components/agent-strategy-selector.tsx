import type { ReactNode } from 'react'
import type { Strategy } from './agent-strategy'
import type {
  ListProps,
  ListRef,
} from '@/app/components/workflow/block-selector/marketplace-plugin/list'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTitle, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/hooks'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import PluginList from '@/app/components/workflow/block-selector/marketplace-plugin/list'
import { useGetLanguage } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { renderI18nObject } from '@/i18n/metadata'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { ViewType } from '../../../block-selector/types'
import ViewTypeSelect from '../../../block-selector/view-type-select'
import { useStrategyInfo } from '../../agent/use-config'
import { InstallPluginButton } from './install-plugin-button'
import { SwitchPluginVersion } from './switch-plugin-version'

const DEFAULT_TAGS: ListProps['tags'] = []

const AgentStrategyList = dynamic(
  () => import('./agent-strategy-list').then((module) => module.AgentStrategyList),
  { loading: () => <div className="h-24 animate-pulse rounded-lg bg-background-section" /> },
)

const NotFoundWarn = (props: { title: string; description: ReactNode }) => {
  const { title, description } = props
  const { t } = useTranslation(['workflow'])
  return (
    <Infotip>
      <InfotipTrigger
        aria-label={title}
        iconVariant="warning"
        iconSize="large"
        className="text-text-destructive"
      />
      <InfotipContent className="w-45">
        <div className="space-y-1">
          <InfotipTitle className="font-semibold text-text-primary">{title}</InfotipTitle>
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
  const filteredProviders = useMemo(() => {
    return (providers.data ?? []).filter((provider) =>
      provider.declaration.identity.name.toLowerCase().includes(query.toLowerCase()),
    )
  }, [query, providers.data])
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
  const { t } = useTranslation(['workflow'])

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
            <AgentStrategyList
              providers={filteredProviders}
              viewType={viewType}
              onSelect={(provider, strategy) => {
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
