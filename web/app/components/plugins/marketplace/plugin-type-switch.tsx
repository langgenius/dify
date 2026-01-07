'use client'
import { useTranslation } from '#i18n'
import {
  RiArchive2Line,
  RiBrain2Line,
  RiDatabase2Line,
  RiHammerLine,
  RiPuzzle2Line,
  RiSpeakAiLine,
} from '@remixicon/react'
import { useCallback, useEffect } from 'react'
import { Trigger as TriggerIcon } from '@/app/components/base/icons/src/vender/plugin'
import { cn } from '@/utils/classnames'
import { PluginCategoryEnum } from '../types'
import { useMarketplaceContext } from './context'

export const PLUGIN_TYPE_SEARCH_MAP = {
  all: 'all',
  model: PluginCategoryEnum.model,
  tool: PluginCategoryEnum.tool,
  agent: PluginCategoryEnum.agent,
  extension: PluginCategoryEnum.extension,
  datasource: PluginCategoryEnum.datasource,
  trigger: PluginCategoryEnum.trigger,
  bundle: 'bundle',
}
type PluginTypeSwitchProps = {
  className?: string
  showSearchParams?: boolean
}
const PluginTypeSwitch = ({
  className,
  showSearchParams,
}: PluginTypeSwitchProps) => {
  const { t } = useTranslation()
  const activePluginType = useMarketplaceContext(s => s.activePluginType)
  const handleActivePluginTypeChange = useMarketplaceContext(s => s.handleActivePluginTypeChange)

  const options = [
    {
      value: PLUGIN_TYPE_SEARCH_MAP.all,
      text: t('category.all', { ns: 'plugin' }),
      icon: null,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.model,
      text: t('category.models', { ns: 'plugin' }),
      icon: <RiBrain2Line className="mr-1.5 h-4 w-4" />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.tool,
      text: t('category.tools', { ns: 'plugin' }),
      icon: <RiHammerLine className="mr-1.5 h-4 w-4" />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.datasource,
      text: t('category.datasources', { ns: 'plugin' }),
      icon: <RiDatabase2Line className="mr-1.5 h-4 w-4" />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.trigger,
      text: t('category.triggers', { ns: 'plugin' }),
      icon: <TriggerIcon className="mr-1.5 h-4 w-4" />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.agent,
      text: t('category.agents', { ns: 'plugin' }),
      icon: <RiSpeakAiLine className="mr-1.5 h-4 w-4" />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.extension,
      text: t('category.extensions', { ns: 'plugin' }),
      icon: <RiPuzzle2Line className="mr-1.5 h-4 w-4" />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.bundle,
      text: t('category.bundles', { ns: 'plugin' }),
      icon: <RiArchive2Line className="mr-1.5 h-4 w-4" />,
    },
  ]

  const handlePopState = useCallback(() => {
    if (!showSearchParams)
      return
    // nuqs handles popstate automatically
    const url = new URL(window.location.href)
    const category = url.searchParams.get('category') || PLUGIN_TYPE_SEARCH_MAP.all
    handleActivePluginTypeChange(category)
  }, [showSearchParams, handleActivePluginTypeChange])

  useEffect(() => {
    // nuqs manages popstate internally, but we keep this for URL sync
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [handlePopState])

  return (
    <div className={cn(
      'flex shrink-0 items-center justify-center space-x-2 bg-background-body py-3',
      className,
    )}
    >
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
