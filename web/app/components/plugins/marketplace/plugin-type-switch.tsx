'use client'
import type { ActivePluginType } from './constants'
import { cn } from '@langgenius/dify-ui/cn'
import { useSetAtom } from 'jotai'
import { Fragment } from 'react'
import { useTranslation } from '#i18n'
import PluginIcon from '@/app/components/base/icons/src/vender/plugin/Plugin'
import { searchModeAtom, useActivePluginType } from './atoms'
import { PLUGIN_CATEGORY_WITH_COLLECTIONS, PLUGIN_TYPE_SEARCH_MAP } from './constants'
import styles from './plugin-type-switch.module.css'

type PluginTypeSwitchProps = {
  className?: string
  variant?: 'default' | 'hero' | 'home'
}

function PluginTypeSwitch({ className, variant = 'default' }: PluginTypeSwitchProps) {
  const { t } = useTranslation()
  const [activePluginType, handleActivePluginTypeChange] = useActivePluginType()
  const setSearchMode = useSetAtom(searchModeAtom)
  const isHero = variant === 'hero'
  const isHome = variant === 'home'
  const iconClassName = 'mr-1.5 size-4'

  const options: Array<{
    value: ActivePluginType
    text: string
    icon: React.ReactNode | null
  }> = [
    {
      value: PLUGIN_TYPE_SEARCH_MAP.all,
      text: isHero
        ? t(($) => $['marketplace.allPlugins'], { ns: 'plugin' })
        : t(($) => $['category.all'], { ns: 'plugin' }),
      icon: isHero || isHome ? <PluginIcon className={iconClassName} /> : null,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.model,
      text: t(($) => $['category.models'], { ns: 'plugin' }),
      icon: <span aria-hidden className={cn('i-ri-brain-2-line', iconClassName)} />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.tool,
      text: t(($) => $['category.tools'], { ns: 'plugin' }),
      icon: <span aria-hidden className={cn('i-ri-hammer-line', iconClassName)} />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.datasource,
      text: t(($) => $[isHome ? 'categorySingle.datasource' : 'category.datasources'], {
        ns: 'plugin',
      }),
      icon: <span aria-hidden className={cn('i-ri-database-2-line', iconClassName)} />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.agent,
      text: t(($) => $[isHome ? 'categorySingle.agent' : 'category.agents'], { ns: 'plugin' }),
      icon: (
        <span
          aria-hidden
          className={cn('i-custom-vender-integrations-agent-strategy', iconClassName)}
        />
      ),
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.trigger,
      text: t(($) => $['category.triggers'], { ns: 'plugin' }),
      icon: (
        <span aria-hidden className={cn('i-custom-vender-integrations-trigger', iconClassName)} />
      ),
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.extension,
      text: t(($) => $['category.extensions'], { ns: 'plugin' }),
      icon: <span aria-hidden className={cn('i-ri-puzzle-2-line', iconClassName)} />,
    },
    {
      value: PLUGIN_TYPE_SEARCH_MAP.bundle,
      text: t(($) => $['category.bundles'], { ns: 'plugin' }),
      icon: <span aria-hidden className={cn('i-ri-archive-2-line', iconClassName)} />,
    },
  ]

  return (
    <div
      className={cn(
        isHero
          ? 'flex shrink-0 items-center gap-1 overflow-x-auto'
          : isHome
            ? 'flex w-full shrink-0 items-center justify-start gap-1 overflow-x-auto'
            : 'flex shrink-0 items-center justify-center space-x-2 bg-background-body py-3',
        className,
      )}
      role="group"
      aria-label={t(($) => $['marketplace.allPlugins'], { ns: 'plugin' })}
    >
      {options.map((option, index) => {
        const isActive = activePluginType === option.value

        return (
          <Fragment key={option.value}>
            <button
              type="button"
              aria-pressed={isActive}
              className={cn(
                'flex h-8 cursor-pointer items-center rounded-lg border border-transparent px-2.5 system-md-medium whitespace-nowrap outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                isHero
                  ? 'text-text-primary-on-surface'
                  : isHome
                    ? cn('min-w-12 justify-center text-text-tertiary', styles.homeItem)
                    : 'text-text-tertiary',
                !isActive &&
                  (isHero
                    ? 'hover:bg-white/20'
                    : !isHome && 'hover:bg-state-base-hover hover:text-text-secondary'),
                isActive &&
                  (isHero
                    ? 'border-white/95 bg-components-main-nav-nav-button-bg-active text-saas-dify-blue-inverted shadow-md backdrop-blur-[5px]'
                    : isHome
                      ? styles.homeItemActive
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
            </button>
            {isHero && index === 0 && (
              <div
                aria-hidden
                className="flex h-8 items-center justify-center px-2 system-md-regular text-text-primary-on-surface"
              >
                ·
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

export default PluginTypeSwitch
