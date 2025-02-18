'use client'
import {
  RiArchive2Line,
  RiBrain2Line,
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

export const PLUGIN_TYPE_SEARCH_MAP = {
  all: 'all',
  model: PluginType.model,
  tool: PluginType.tool,
  agent: PluginType.agent,
  extension: PluginType.extension,
  bundle: 'bundle',
}
type PluginTypeSwitchProps = {
  locale?: string
  className?: string
  searchBoxAutoAnimate?: boolean
}
const PluginTypeSwitch = ({
  locale,
  className,
  searchBoxAutoAnimate,
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

  return (
    <div className={cn(
      'bg-background-body flex shrink-0 items-center justify-center space-x-2 py-3',
      searchBoxCanAnimate && 'sticky top-[56px] z-10',
      className,
    )}>
      {
        options.map(option => (
          <div
            key={option.value}
            className={cn(
              'hover:bg-state-base-hover hover:text-text-secondary system-md-medium text-text-tertiary flex h-8 cursor-pointer items-center rounded-xl border border-transparent px-3',
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
