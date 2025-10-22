'use client'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BlockEnum, type ToolWithProvider } from '../types'
import type { ToolDefaultValue, ToolValue } from './types'
import type { Plugin } from '@/app/components/plugins/types'
import { useGetLanguage } from '@/context/i18n'
import BlockIcon from '../block-icon'
import Tooltip from '@/app/components/base/tooltip'
import { RiLoader2Line, RiMoreLine } from '@remixicon/react'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'
import Loading from '@/app/components/base/loading'
import Link from 'next/link'
import { getMarketplaceUrl } from '@/utils/var'
import { ToolTypeEnum } from './types'
import { ViewType } from './view-type-select'
import Tools from './tools'
import { formatNumber } from '@/utils/format'
import Action from '@/app/components/workflow/block-selector/market-place-plugin/action'
import { ArrowDownDoubleLine, ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/arrows'

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
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined')
      return false
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'true'
  })

  const installMutation = useInstallPackageFromMarketPlace({
    onSuccess: async () => {
      await onInstallSuccess?.()
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
        className='flex w-full items-center rounded-md px-0 py-1 text-left text-text-primary'
        onClick={() => setIsCollapsed(prev => !prev)}
      >
        <span className='system-xs-medium text-text-primary'>{t('workflow.tabs.featuredTools')}</span>
        <ArrowDownRoundFill className={`ml-0.5 h-4 w-4 text-text-tertiary transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'}`} />
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
              className='group mt-1 flex cursor-pointer items-center gap-x-2 rounded-lg py-1 pl-3 pr-2 text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary'
              onClick={() => {
                setVisibleCount(count => Math.min(count + INITIAL_VISIBLE_COUNT, MAX_RECOMMENDED_COUNT, plugins.length))
              }}
            >
              <div className='flex items-center px-1 text-text-tertiary transition-colors group-hover:text-text-secondary'>
                <RiMoreLine className='size-4 group-hover:hidden' />
                <ArrowDownDoubleLine className='hidden size-4 group-hover:block' />
              </div>
              <div className='system-xs-regular'>
                {t('workflow.tabs.showMoreFeatured')}
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
  const installCountLabel = t('plugin.install', { num: formatNumber(plugin.install_count || 0) })
  const [actionOpen, setActionOpen] = useState(false)
  const [isActionHovered, setIsActionHovered] = useState(false)

  useEffect(() => {
    if (!actionOpen)
      return

    const handleScroll = () => {
      setActionOpen(false)
      setIsActionHovered(false)
    }

    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [actionOpen])

  return (
    <Tooltip
      position='right'
      needsDelay={false}
      popupClassName='!p-0 !px-3 !py-2.5 !w-[224px] !leading-[18px] !text-xs !text-gray-700 !border-[0.5px] !border-black/5 !rounded-xl !shadow-lg'
      popupContent={(
        <div>
          <BlockIcon size='md' className='mb-2' type={BlockEnum.Tool} toolIcon={plugin.icon} />
          <div className='mb-1 text-sm leading-5 text-text-primary'>{label}</div>
          <div className='text-xs leading-[18px] text-text-secondary'>{description}</div>
        </div>
      )}
      disabled={!description || isActionHovered || actionOpen}
    >
      <div
        className='group flex h-8 w-full items-center rounded-lg pl-3 pr-1 hover:bg-state-base-hover'
        onMouseLeave={() => {
          if (!actionOpen)
            setIsActionHovered(false)
        }}
      >
        <div className='flex h-full min-w-0 items-center'>
          <BlockIcon type={BlockEnum.Tool} toolIcon={plugin.icon} />
          <div className='ml-2 min-w-0'>
            <div className='system-sm-medium truncate text-text-secondary'>{label}</div>
          </div>
        </div>
        <div className='ml-auto flex h-full items-center gap-1 pl-1'>
          <span className='system-xs-regular text-text-tertiary group-hover:hidden'>{installCountLabel}</span>
          <div
            className={`h-full items-center gap-1 [&_.action-btn]:h-6 [&_.action-btn]:min-h-0 [&_.action-btn]:w-6 [&_.action-btn]:rounded-lg [&_.action-btn]:p-0 ${actionOpen ? 'flex' : 'hidden group-hover:flex'}`}
            onMouseEnter={() => setIsActionHovered(true)}
            onMouseLeave={() => {
              if (!actionOpen)
                setIsActionHovered(false)
            }}
          >
            <button
              type='button'
              className='system-xs-medium flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 text-components-button-secondary-accent-text hover:bg-state-base-hover'
              disabled={installing}
              onClick={onInstall}
            >
              {installing ? t('workflow.nodes.agent.pluginInstaller.installing') : t('workflow.nodes.agent.pluginInstaller.install')}
              {installing && <RiLoader2Line className='size-3 animate-spin' />}
            </button>
            <div className='flex items-center'>
              <Action
                open={actionOpen}
                onOpenChange={(value) => {
                  setActionOpen(value)
                  setIsActionHovered(value)
                }}
                author={plugin.org}
                name={plugin.name}
                version={plugin.latest_version}
              />
            </div>
          </div>
        </div>
      </div>
    </Tooltip>
  )
}

export default FeaturedTools
