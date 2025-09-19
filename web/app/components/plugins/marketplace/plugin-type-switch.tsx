'use client'
import {
  RiArchive2Line,
  RiBrain2Line,
  RiDatabase2Line,
  RiHammerLine,
  RiPuzzle2Line,
  RiSpeakAiLine,
} from '@remixicon/react'
import { PluginType } from '../types'
import { useMarketplaceContext } from './context'
import {
  useMixedTranslation,
  useSearchBoxAutoAnimate,
} from './hooks'
import cn from '@/utils/classnames'
import { useCallback, useEffect } from 'react'

export const PLUGIN_TYPE_SEARCH_MAP = {
  all: 'all',
  model: PluginType.model,
  tool: PluginType.tool,
  agent: PluginType.agent,
  extension: PluginType.extension,
  datasource: PluginType.datasource,
  bundle: 'bundle',
}
type PluginTypeSwitchProps = {
  locale?: string
  className?: string
  searchBoxAutoAnimate?: boolean
  showSearchParams?: boolean
}
const PluginTypeSwitch = ({
  locale,
  className,
  searchBoxAutoAnimate,
  showSearchParams,
}: PluginTypeSwitchProps) => {
  const { t } = useMixedTranslation(locale)
  const activePluginType = useMarketplaceContext(s => s.activePluginType)
  const handleActivePluginTypeChange = useMarketplaceContext(s => s.handleActivePluginTypeChange)
  const { searchBoxCanAnimate } = useSearchBoxAutoAnimate(searchBoxAutoAnimate)

  const options = [
    {
      value: PLUGIN_TYPE_SEARCH_MAP.all,
      text: t('plugin.category.all'),
      icon: null,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.model,
      text: t('plugin.category.models'),
      icon: <RiBrain2Line className='mr-1.5 h-4 w-4' />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.tool,
      text: t('plugin.category.tools'),
      icon: <RiHammerLine className='mr-1.5 h-4 w-4' />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.datasource,
      text: t('plugin.category.datasources'),
      icon: <RiDatabase2Line className='mr-1.5 h-4 w-4' />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.agent,
      text: t('plugin.category.agents'),
      icon: <RiSpeakAiLine className='mr-1.5 h-4 w-4' />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.extension,
      text: t('plugin.category.extensions'),
      icon: <RiPuzzle2Line className='mr-1.5 h-4 w-4' />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.bundle,
      text: t('plugin.category.bundles'),
      icon: <RiArchive2Line className='mr-1.5 h-4 w-4' />,
    },
  ]

  const handlePopState = useCallback(() => {
    if (!showSearchParams)
      return
    const url = new URL(window.location.href)
    const category = url.searchParams.get('category') || PLUGIN_TYPE_SEARCH_MAP.all
    handleActivePluginTypeChange(category)
  }, [showSearchParams, handleActivePluginTypeChange])

  useEffect(() => {
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [handlePopState])

  return (
    <div className={cn(
      'flex shrink-0 items-center justify-center space-x-2 bg-background-body py-3',
      searchBoxCanAnimate && 'sticky top-[56px] z-10',
      className,
    )}>
      {
        options.map(option => (
          <div
            key={option.value}
            className={cn(
              'system-md-medium flex h-8 cursor-pointer items-center rounded-xl border border-transparent px-3 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
              activePluginType === option.value && 'border-components-main-nav-nav-button-border !bg-components-main-nav-nav-button-bg-active !text-components-main-nav-nav-button-text-active shadow-xs',
            )}
            onClick={() => {
              handleActivePluginTypeChange(option.value)
            }}
          >
            {option.icon}
            {option.text}
          </div>
        ))
      }
    </div>
  )
}

export default PluginTypeSwitch
