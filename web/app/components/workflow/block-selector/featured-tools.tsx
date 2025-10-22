'use client'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BlockEnum, type ToolWithProvider } from '../types'
import type { ToolDefaultValue, ToolValue } from './types'
import type { Plugin } from '@/app/components/plugins/types'
import { useGetLanguage } from '@/context/i18n'
import Button from '@/app/components/base/button'
import BlockIcon from '../block-icon'
import { RiArrowDownSLine, RiArrowRightSLine, RiLoader2Line, RiMoreLine } from '@remixicon/react'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'
import Loading from '@/app/components/base/loading'
import Link from 'next/link'
import { getMarketplaceUrl } from '@/utils/var'
import { ToolTypeEnum } from './types'
import { ViewType } from './view-type-select'
import Tools from './tools'

const MAX_RECOMMENDED_COUNT = 15
const INITIAL_VISIBLE_COUNT = 5

type FeaturedToolsProps = {
  plugins: Plugin[]
  providerMap: Map<string, ToolWithProvider>
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  selectedTools?: ToolValue[]
  canChooseMCPTool?: boolean
  isLoading?: boolean
  onInstallSuccess?: () => void
}

const STORAGE_KEY = 'workflow_tools_featured_collapsed'

const FeaturedTools = ({
  plugins,
  providerMap,
  onSelect,
  selectedTools,
  canChooseMCPTool,
  isLoading = false,
  onInstallSuccess,
}: FeaturedToolsProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT)
  const [installingIdentifier, setInstallingIdentifier] = useState<string | null>(null)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false)

  const installMutation = useInstallPackageFromMarketPlace({
    onSuccess: () => {
      onInstallSuccess?.()
    },
    onSettled: () => {
      setInstallingIdentifier(null)
    },
  })

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored !== null)
      setIsCollapsed(stored === 'true')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    window.localStorage.setItem(STORAGE_KEY, String(isCollapsed))
  }, [isCollapsed])

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT)
  }, [plugins])

  const visiblePlugins = useMemo(
    () => plugins.slice(0, Math.min(MAX_RECOMMENDED_COUNT, visibleCount)),
    [plugins, visibleCount],
  )

  const installedProviders = useMemo(
    () =>
      visiblePlugins
        .map(plugin => providerMap.get(plugin.plugin_id))
        .filter((provider): provider is ToolWithProvider => Boolean(provider)),
    [visiblePlugins, providerMap],
  )

  const uninstalledPlugins = useMemo(
    () => visiblePlugins.filter(plugin => !providerMap.has(plugin.plugin_id)),
    [visiblePlugins, providerMap],
  )

  const showMore = visibleCount < Math.min(MAX_RECOMMENDED_COUNT, plugins.length)
  const isMutating = installMutation.isPending
  const showEmptyState = !isLoading && visiblePlugins.length === 0

  return (
    <div className='px-3 pb-3 pt-2'>
      <button
        type='button'
        className='flex w-full items-center justify-between rounded-md px-0 py-1 text-left text-text-tertiary'
        onClick={() => setIsCollapsed(prev => !prev)}
      >
        <span className='system-xs-medium'>{t('workflow.tabs.featuredTools')}</span>
        {isCollapsed ? <RiArrowRightSLine className='size-3.5' /> : <RiArrowDownSLine className='size-3.5' />}
      </button>

      {!isCollapsed && (
        <>
          {isLoading && (
            <div className='py-3'>
              <Loading type='app' />
            </div>
          )}

          {showEmptyState && (
            <p className='system-xs-regular py-2 text-text-tertiary'>
              <Link className='text-text-accent' href={getMarketplaceUrl('', { category: 'tool' })} target='_blank' rel='noopener noreferrer'>
                {t('workflow.tabs.noFeaturedPlugins')}
              </Link>
            </p>
          )}

          {!showEmptyState && !isLoading && (
            <>
              {installedProviders.length > 0 && (
                <Tools
                  className='p-0'
                  tools={installedProviders}
                  onSelect={onSelect}
                  canNotSelectMultiple
                  toolType={ToolTypeEnum.All}
                  viewType={ViewType.flat}
                  hasSearchText={false}
                  selectedTools={selectedTools}
                  canChooseMCPTool={canChooseMCPTool}
                />
              )}

              {uninstalledPlugins.length > 0 && (
                <div className='mt-1 flex flex-col gap-1'>
                  {uninstalledPlugins.map(plugin => (
                    <FeaturedToolUninstalledItem
                      key={plugin.plugin_id}
                      plugin={plugin}
                      language={language}
                      installing={isMutating && installingIdentifier === plugin.latest_package_identifier}
                      onInstall={() => {
                        if (isMutating)
                          return
                        setInstallingIdentifier(plugin.latest_package_identifier)
                        installMutation.mutate(plugin.latest_package_identifier)
                      }}
                      t={t}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {!isLoading && visiblePlugins.length > 0 && showMore && (
            <div
              className='mt-1 flex cursor-pointer items-center gap-x-2 py-1 pl-3 pr-2 text-text-tertiary hover:text-text-secondary'
              onClick={() => {
                setVisibleCount(count => Math.min(count + INITIAL_VISIBLE_COUNT, MAX_RECOMMENDED_COUNT, plugins.length))
              }}
            >
              <div className='px-1'>
                <RiMoreLine className='size-4' />
              </div>
              <div className='system-xs-regular'>
                {t('common.operation.more')}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

type FeaturedToolUninstalledItemProps = {
  plugin: Plugin
  language: string
  installing: boolean
  onInstall: () => void
  t: (key: string, options?: Record<string, any>) => string
}

function FeaturedToolUninstalledItem({
  plugin,
  language,
  installing,
  onInstall,
  t,
}: FeaturedToolUninstalledItemProps) {
  const label = plugin.label?.[language] || plugin.name
  const description = typeof plugin.brief === 'object' ? plugin.brief[language] : plugin.brief
  const installCountLabel = t('plugin.install', { num: plugin.install_count?.toLocaleString() ?? 0 })

  return (
    <div className='group flex items-center justify-between rounded-lg px-3 py-2 hover:bg-state-base-hover'>
      <div className='flex min-w-0 items-center gap-3'>
        <BlockIcon type={BlockEnum.Tool} toolIcon={plugin.icon} />
        <div className='min-w-0'>
          <div className='system-sm-medium truncate text-text-primary'>{label}</div>
          {description && (
            <div className='system-xs-regular truncate text-text-tertiary'>{description}</div>
          )}
        </div>
      </div>
      <div className='ml-3 flex items-center'>
        <span className='system-xs-regular text-text-tertiary group-hover:hidden'>{installCountLabel}</span>
        <Button
          size='small'
          variant='secondary'
          className='hidden items-center gap-1 group-hover:flex'
          disabled={installing}
          onClick={onInstall}
        >
          {installing ? t('workflow.nodes.agent.pluginInstaller.installing') : t('workflow.nodes.agent.pluginInstaller.install')}
          {installing && <RiLoader2Line className='size-3 animate-spin' />}
        </Button>
      </div>
    </div>
  )
}

export default FeaturedTools
