'use client'

import type { Template } from '../types'
import { useLocale, useTranslation } from '#i18n'
import Image from 'next/image'
import Link from 'next/link'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import useTheme from '@/hooks/use-theme'
import { cn } from '@/utils/classnames'
import { getIconFromMarketPlace } from '@/utils/get-icon'
import { formatUsedCount } from '@/utils/template'
import { getMarketplaceUrl } from '@/utils/var'

type TemplateCardProps = {
  template: Template
  className?: string
}

// Number of tag icons to show before showing "+X"
const MAX_VISIBLE_DEPS_PLUGINS = 7

// Soft background color palette for avatar
const AVATAR_BG_COLORS = [
  'bg-components-icon-bg-red-soft',
  'bg-components-icon-bg-orange-dark-soft',
  'bg-components-icon-bg-yellow-soft',
  'bg-components-icon-bg-green-soft',
  'bg-components-icon-bg-teal-soft',
  'bg-components-icon-bg-blue-light-soft',
  'bg-components-icon-bg-blue-soft',
  'bg-components-icon-bg-indigo-soft',
  'bg-components-icon-bg-violet-soft',
  'bg-components-icon-bg-pink-soft',
]

// Simple hash function to get consistent color per template
const getAvatarBgClass = (id: string): string => {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return AVATAR_BG_COLORS[Math.abs(hash) % AVATAR_BG_COLORS.length]
}

const TemplateCardComponent = ({
  template,
  className,
}: TemplateCardProps) => {
  const locale = useLocale()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { id, template_name, overview, icon, publisher_handle, usage_count, icon_background, deps_plugins } = template
  const isIconUrl = !!icon && /^(?:https?:)?\/\//.test(icon)

  const avatarBgStyle = useMemo(() => {
    // If icon_background is provided (hex or rgba), use it directly
    if (icon_background)
      return { backgroundColor: icon_background }
    return undefined
  }, [icon_background])

  const avatarBgClass = useMemo(() => {
    // Only use class-based color if no inline style
    if (icon_background)
      return ''
    return getAvatarBgClass(id)
  }, [icon_background, id])

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
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-4">
        {/* Avatar */}
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border-[0.5px] border-divider-regular p-1',
            avatarBgClass,
          )}
          style={avatarBgStyle}
        >
          {isIconUrl
            ? (
                <Image
                  src={icon}
                  alt={template_name}
                  width={24}
                  height={24}
                  className="h-6 w-6 object-contain"
                />
              )
            : (
                <span className="text-2xl leading-[1.2]">{icon || '📄'}</span>
              )}
        </div>
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
