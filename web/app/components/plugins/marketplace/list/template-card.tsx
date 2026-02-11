'use client'

import type { Template } from '../types'
import { useLocale, useTranslation } from '#i18n'
import Link from 'next/link'
import * as React from 'react'
import { useCallback } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import CornerMark from '@/app/components/plugins/card/base/corner-mark'
import useTheme from '@/hooks/use-theme'
import { cn } from '@/utils/classnames'
import { getIconFromMarketPlace } from '@/utils/get-icon'
import { formatUsedCount } from '@/utils/template'
import { getMarketplaceUrl } from '@/utils/var'
import { getTemplateIconUrl } from '../utils'

type TemplateCardProps = {
  template: Template
  className?: string
}

// Number of tag icons to show before showing "+X"
const MAX_VISIBLE_DEPS_PLUGINS = 7

const TemplateCardComponent = ({
  template,
  className,
}: TemplateCardProps) => {
  const locale = useLocale()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { id, template_name, overview, icon, publisher_handle, usage_count, icon_background, deps_plugins, kind } = template
  const isSandbox = kind === 'sandboxed'
  const iconUrl = getTemplateIconUrl(template)

  const handleClick = useCallback(() => {
    const url = getMarketplaceUrl(`/templates/${publisher_handle}/${template_name}`, {
      theme,
      language: locale,
      templateId: id,
      creationType: 'templates',
    })
    window.open(url, '_blank')
  }, [publisher_handle, template_name, theme, locale, id])

  const visibleDepsPlugins = deps_plugins?.slice(0, MAX_VISIBLE_DEPS_PLUGINS) || []
  const remainingDepsPluginsCount = deps_plugins ? Math.max(0, deps_plugins.length - MAX_VISIBLE_DEPS_PLUGINS) : 0

  const formattedUsedCount = formatUsedCount(usage_count, { precision: 0, rounding: 'floor' })

  return (
    <div
      className={cn(
        'hover-bg-components-panel-on-panel-item-bg relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs',
        className,
      )}
      onClick={handleClick}
    >
      {isSandbox && <CornerMark text="Sandbox" />}
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-4">
        {/* Avatar */}
        <AppIcon
          size="large"
          iconType={iconUrl ? 'image' : 'emoji'}
          icon={iconUrl ? undefined : (icon || '📄')}
          imageUrl={iconUrl || undefined}
          background={icon_background || undefined}
        />
        {/* Title */}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <p className="system-md-medium truncate text-text-primary">{template_name}</p>
          <div className="system-xs-regular flex items-center gap-2 text-text-tertiary">
            <span className="flex shrink-0 items-center gap-1">
              <span className="shrink-0">{t('marketplace.templateCard.by', { ns: 'plugin' })}</span>
              <Link
                href={`/creators/${publisher_handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate hover:text-text-secondary hover:underline"
                onClick={e => e.stopPropagation()}
              >
                {publisher_handle}
              </Link>
            </span>
            <span className="shrink-0">·</span>
            <span className="shrink-0">
              {t('usedCount', { ns: 'plugin', num: formattedUsedCount || 0 })}
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="shrink-0 px-4 pb-2 pt-1">
        <p
          className="system-xs-regular line-clamp-2 min-h-[32px] text-text-secondary"
          title={overview}
        >
          {overview}
        </p>
      </div>

      {/* Bottom Info Bar - Tags as icons */}
      <div className="mt-auto flex min-h-7 shrink-0 items-center gap-1 px-4 py-1">
        {deps_plugins && deps_plugins.length > 0 && (
          <>
            {visibleDepsPlugins.map((depsPlugin, index) => (
              <div
                key={`${id}-depsPlugin-${index}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border-[0.5px] border-effects-icon-border bg-background-default-dodge"
                title={depsPlugin}
              >
                <img
                  className="h-full w-full object-cover"
                  src={getIconFromMarketPlace(depsPlugin)}
                  alt={depsPlugin}
                />
              </div>
            ))}
            {remainingDepsPluginsCount > 0 && (
              <div className="flex items-center justify-center p-0.5">
                <span className="system-xs-regular text-text-tertiary">
                  +
                  {remainingDepsPluginsCount}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const TemplateCard = React.memo(TemplateCardComponent)

export default TemplateCard
