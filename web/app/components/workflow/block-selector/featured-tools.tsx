'use client'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BlockEnum, type ToolWithProvider } from '../types'
import type { ToolDefaultValue, ToolValue } from './types'
import type { Plugin } from '@/app/components/plugins/types'
import { useGetLanguage } from '@/context/i18n'
import Button from '@/app/components/base/button'
import ActionItem from './tool/action-item'
import type { Tool } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import BlockIcon from '../block-icon'
import { RiArrowDownSLine, RiArrowUpSLine, RiLoader2Line } from '@remixicon/react'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'

const MAX_RECOMMENDED_COUNT = 15
const INITIAL_VISIBLE_COUNT = 5

type FeaturedToolsProps = {
  plugins: Plugin[]
  providerMap: Map<string, ToolWithProvider>
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  selectedTools?: ToolValue[]
  canChooseMCPTool?: boolean
  installedPluginIds: Set<string>
  loadingInstalledStatus: boolean
  onInstallSuccess?: () => void
}

function isToolSelected(tool: Tool, provider: ToolWithProvider, selectedTools?: ToolValue[]): boolean {
  if (!selectedTools || !selectedTools.length)
    return false
  return selectedTools.some(item => (item.provider_name === provider.name || item.provider_name === provider.id) && item.tool_name === tool.name)
}

const FeaturedTools = ({
  plugins,
  providerMap,
  onSelect,
  selectedTools,
  canChooseMCPTool,
  installedPluginIds,
  loadingInstalledStatus,
  onInstallSuccess,
}: FeaturedToolsProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT)
  const [installingIdentifier, setInstallingIdentifier] = useState<string | null>(null)
  const installMutation = useInstallPackageFromMarketPlace({
    onSuccess: () => {
      onInstallSuccess?.()
    },
    onSettled: () => {
      setInstallingIdentifier(null)
    },
  })

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT)
  }, [plugins])

  const visiblePlugins = useMemo(
    () => plugins.slice(0, Math.min(MAX_RECOMMENDED_COUNT, visibleCount)),
    [plugins, visibleCount],
  )

  if (!visiblePlugins.length)
    return null

  const showMore = visibleCount < Math.min(MAX_RECOMMENDED_COUNT, plugins.length)

  return (
    <div className='px-3 pb-3 pt-2'>
      <div className='system-xs-medium mb-2 text-text-tertiary'>
        {t('workflow.tabs.featuredTools')}
      </div>
      <div className='space-y-2'>
        {visiblePlugins.map(plugin => renderFeaturedToolItem({
          plugin,
          providerMap,
          installedPluginIds,
          installMutationPending: installMutation.isPending,
          installingIdentifier,
          loadingInstalledStatus,
          canChooseMCPTool,
          onSelect,
          selectedTools,
          language,
          installPlugin: installMutation.mutate,
          setInstallingIdentifier,
        }))}
      </div>
      {showMore && (
        <Button
          className='mt-2 w-full'
          size='small'
          variant='ghost'
          onClick={() => {
            setVisibleCount(count => Math.min(count + INITIAL_VISIBLE_COUNT, MAX_RECOMMENDED_COUNT, plugins.length))
          }}
        >
          {t('workflow.tabs.showMoreFeatured')}
        </Button>
      )}
    </div>
  )
}

type FeaturedToolItemProps = {
  plugin: Plugin
  provider: ToolWithProvider | undefined
  isInstalled: boolean
  installDisabled: boolean
  canChooseMCPTool?: boolean
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  selectedTools?: ToolValue[]
  language: string
  onInstall: () => void
  isInstalling: boolean
}

function FeaturedToolItem({
  plugin,
  provider,
  isInstalled,
  installDisabled,
  canChooseMCPTool,
  onSelect,
  selectedTools,
  language,
  onInstall,
  isInstalling,
}: FeaturedToolItemProps) {
  const { t } = useTranslation()
  const [isExpanded, setExpanded] = useState(false)
  const hasProvider = Boolean(provider)
  const installCountLabel = t('plugin.install', { num: plugin.install_count?.toLocaleString() ?? 0 })
  const description = typeof plugin.brief === 'object' ? plugin.brief[language] : plugin.brief

  useEffect(() => {
    if (!hasProvider)
      setExpanded(false)
  }, [hasProvider])

  let toggleLabel: string
  if (!hasProvider)
    toggleLabel = t('workflow.common.syncingData')
  else if (isExpanded)
    toggleLabel = t('workflow.tabs.hideActions')
  else
    toggleLabel = t('workflow.tabs.usePlugin')

  return (
    <div className='rounded-lg border border-divider-subtle bg-components-panel-bg-blur px-3 py-2'>
      <div className='flex items-start gap-2'>
        <BlockIcon type={BlockEnum.Tool} toolIcon={plugin.icon} />
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <div className='truncate text-sm font-medium text-text-primary'>
              {plugin.label?.[language] || plugin.name}
            </div>
            {isInstalled && (
              <span className='system-xs-regular rounded-full border border-divider-subtle px-2 py-0.5 text-text-tertiary'>
                {t('workflow.tabs.installed')}
              </span>
            )}
          </div>
          <div className='system-xs-regular mt-0.5 line-clamp-2 text-text-secondary'>
            {description}
          </div>
          <div className='system-xs-regular mt-1 flex items-center gap-2 text-text-tertiary'>
            <span>{installCountLabel}</span>
            {plugin.org && <span>{t('workflow.tabs.pluginByAuthor', { author: plugin.org })}</span>}
          </div>
        </div>
        <div className='ml-2 flex shrink-0 flex-col items-end gap-1'>
          {!isInstalled && (
            <Button
              size='small'
              variant='primary'
              disabled={installDisabled}
              onClick={onInstall}
              className='flex items-center gap-1'
            >
              {isInstalling ? t('workflow.nodes.agent.pluginInstaller.installing') : t('workflow.nodes.agent.pluginInstaller.install')}
              {isInstalling && <RiLoader2Line className='size-3 animate-spin' />}
            </Button>
          )}
          {isInstalled && (
            <Button
              size='small'
              variant='secondary'
              onClick={() => setExpanded(expanded => !expanded)}
              disabled={!hasProvider}
              className='flex items-center gap-1'
            >
              {toggleLabel}
              {hasProvider && (isExpanded ? <RiArrowUpSLine className='size-3.5' /> : <RiArrowDownSLine className='size-3.5' />)}
            </Button>
          )}
        </div>
      </div>
      {isInstalled && hasProvider && isExpanded && (
        <div className='mt-2 space-y-1 border-t border-divider-subtle pt-2'>
          {provider.tools.map((tool) => {
            const isSelected = isToolSelected(tool, provider, selectedTools)
            const isMCPTool = provider.type === CollectionType.mcp
            const disabled = isSelected || (!canChooseMCPTool && isMCPTool)

            return (
              <ActionItem
                key={tool.name}
                provider={provider}
                payload={tool}
                onSelect={onSelect}
                disabled={disabled}
                isAdded={isSelected}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

type RenderFeaturedToolParams = {
  plugin: Plugin
  providerMap: Map<string, ToolWithProvider>
  installedPluginIds: Set<string>
  installMutationPending: boolean
  installingIdentifier: string | null
  loadingInstalledStatus: boolean
  canChooseMCPTool?: boolean
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  selectedTools?: ToolValue[]
  language: string
  installPlugin: (uniqueIdentifier: string) => void
  setInstallingIdentifier: (identifier: string | null) => void
}

function renderFeaturedToolItem({
  plugin,
  providerMap,
  installedPluginIds,
  installMutationPending,
  installingIdentifier,
  loadingInstalledStatus,
  canChooseMCPTool,
  onSelect,
  selectedTools,
  language,
  installPlugin,
  setInstallingIdentifier,
}: RenderFeaturedToolParams) {
  const provider = providerMap.get(plugin.plugin_id)
  const isInstalled = installedPluginIds.has(plugin.plugin_id)
  const isInstalling = installMutationPending && installingIdentifier === plugin.latest_package_identifier

  return (
    <FeaturedToolItem
      key={plugin.plugin_id}
      plugin={plugin}
      provider={provider}
      isInstalled={isInstalled}
      installDisabled={loadingInstalledStatus || installMutationPending}
      canChooseMCPTool={canChooseMCPTool}
      onSelect={onSelect}
      selectedTools={selectedTools}
      language={language}
      onInstall={() => {
        if (installMutationPending)
          return
        setInstallingIdentifier(plugin.latest_package_identifier)
        installPlugin(plugin.latest_package_identifier)
      }}
      isInstalling={isInstalling}
    />
  )
}

export default FeaturedTools
