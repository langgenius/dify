'use client'
import type { ActivePluginType } from './constants'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiArchive2Line,
  RiBrain2Line,
  RiDatabase2Line,
  RiHammerLine,
  RiPuzzle2Line,
  RiSpeakAiLine,
} from '@remixicon/react'
import { useSetAtom } from 'jotai'
import { useTranslation } from '#i18n'
import { BoxSparkleFill as PluginIcon, Trigger as TriggerIcon } from '@/app/components/base/icons/src/vender/plugin'
import { searchModeAtom, useActivePluginType } from './atoms'
import { PLUGIN_CATEGORY_WITH_COLLECTIONS, PLUGIN_TYPE_SEARCH_MAP } from './constants'

type PluginTypeSwitchProps = {
  className?: string
  variant?: 'default' | 'hero'
}
const PluginTypeSwitch = ({
  className,
  variant = 'default',
}: PluginTypeSwitchProps) => {
  const { t } = useTranslation()
  const [activePluginType, handleActivePluginTypeChange] = useActivePluginType()
  const setSearchMode = useSetAtom(searchModeAtom)
  const isHero = variant === 'hero'
  const iconClassName = 'mr-1.5 size-4'

  const options: Array<{
    value: ActivePluginType
    text: string
    icon: React.ReactNode | null
  }> = [
    {
      value: PLUGIN_TYPE_SEARCH_MAP.all,
      text: isHero ? t('marketplace.allPlugins', { ns: 'plugin' }) : t('category.all', { ns: 'plugin' }),
      icon: isHero ? <PluginIcon className={iconClassName} /> : null,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.model,
      text: t('category.models', { ns: 'plugin' }),
      icon: <RiBrain2Line className={iconClassName} />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.tool,
      text: t('category.tools', { ns: 'plugin' }),
      icon: <RiHammerLine className={iconClassName} />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.datasource,
      text: t('category.datasources', { ns: 'plugin' }),
      icon: <RiDatabase2Line className={iconClassName} />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.agent,
      text: t('category.agents', { ns: 'plugin' }),
      icon: <RiSpeakAiLine className={iconClassName} />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.trigger,
      text: t('category.triggers', { ns: 'plugin' }),
      icon: <TriggerIcon className={iconClassName} />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.extension,
      text: t('category.extensions', { ns: 'plugin' }),
      icon: <RiPuzzle2Line className={iconClassName} />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.bundle,
      text: t('category.bundles', { ns: 'plugin' }),
      icon: <RiArchive2Line className={iconClassName} />,
    },
  ]

  return (
    <div className={cn(
      isHero
        ? 'flex shrink-0 items-center gap-1 overflow-x-auto'
        : 'flex shrink-0 items-center justify-center space-x-2 bg-background-body py-3',
      className,
    )}
    >
      {
        options.map(option => (
          <div
            key={option.value}
            className={cn(
              'flex h-8 cursor-pointer items-center rounded-lg border border-transparent px-2.5 system-md-medium whitespace-nowrap',
              isHero
                ? 'text-text-primary-on-surface hover:bg-white/20'
                : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
              activePluginType === option.value && (isHero
                ? 'border-white/95 bg-components-main-nav-nav-button-bg-active text-saas-dify-blue-inverted shadow-md backdrop-blur-[5px]'
                : 'border-components-main-nav-nav-button-border bg-components-main-nav-nav-button-bg-active! text-components-main-nav-nav-button-text-active! shadow-xs'),
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
