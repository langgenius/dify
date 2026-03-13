'use client'
import type { ActivePluginType } from './constants'
import { useTranslation } from '#i18n'
import {
  RiArchive2Line,
  RiBrain2Line,
  RiDatabase2Line,
  RiHammerLine,
  RiPuzzle2Line,
  RiSpeakAiLine,
} from '@remixicon/react'
import { useSetAtom } from 'jotai'
import { Trigger as TriggerIcon } from '@/app/components/base/icons/src/vender/plugin'
import { cn } from '@/utils/classnames'
import { searchModeAtom, useActivePluginType } from './atoms'
import { PLUGIN_CATEGORY_WITH_COLLECTIONS, PLUGIN_TYPE_SEARCH_MAP } from './constants'

type PluginTypeSwitchProps = {
  className?: string
}
const PluginTypeSwitch = ({
  className,
}: PluginTypeSwitchProps) => {
  const { t } = useTranslation()
  const [activePluginType, handleActivePluginTypeChange] = useActivePluginType()
  const setSearchMode = useSetAtom(searchModeAtom)

  const options: Array<{
    value: ActivePluginType
    text: string
    icon: React.ReactNode | null
  }> = [
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
              if (PLUGIN_CATEGORY_WITH_COLLECTIONS.has(option.value)) {
                setSearchMode(null)
              }
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
