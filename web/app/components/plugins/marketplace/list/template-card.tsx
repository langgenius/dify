'use client'

import type { Template } from '../types'
import { useLocale } from '#i18n'
import Image from 'next/image'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import useTheme from '@/hooks/use-theme'
import { getLanguage } from '@/i18n-config/language'
import { cn } from '@/utils/classnames'
import { getMarketplaceUrl } from '@/utils/var'

type TemplateCardProps = {
  template: Template
  className?: string
}

// Number of tag icons to show before showing "+X"
const MAX_VISIBLE_TAGS = 7

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
  const { theme } = useTheme()
  const { template_id, name, description, icon, tags, author, used_count, icon_background } = template as Template & { used_count?: number, icon_background?: string }
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
    return getAvatarBgClass(template_id)
  }, [icon_background, template_id])

  const descriptionText = description[getLanguage(locale)] || description.en_US || ''

  const handleClick = useCallback(() => {
    const url = getMarketplaceUrl(`/templates/${author}/${name}`, {
      theme,
      language: locale,
      templateId: template_id,
    })
    window.open(url, '_blank')
  }, [author, name, theme, locale, template_id])

  const visibleTags = tags?.slice(0, MAX_VISIBLE_TAGS) || []
  const remainingTagsCount = tags ? Math.max(0, tags.length - MAX_VISIBLE_TAGS) : 0

  // Format used count (e.g., 134000 -> "134k")
  const formatUsedCount = (count?: number) => {
    if (!count)
      return null
    if (count >= 1000)
      return `${Math.floor(count / 1000)}k`
    return String(count)
  }

  const formattedUsedCount = formatUsedCount(used_count)

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
                  alt={name}
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
          <p className="system-md-medium truncate text-text-primary">{name}</p>
          <div className="system-xs-regular flex items-center gap-2 text-text-tertiary">
            <span className="flex shrink-0 items-center gap-1">
              <span>by</span>
              <span className="truncate">{author}</span>
            </span>
            {formattedUsedCount && (
              <>
                <span className="shrink-0">·</span>
                <span className="shrink-0">
                  {formattedUsedCount}
                  {' '}
                  used
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="shrink-0 px-4 pb-2 pt-1">
        <p
          className="system-xs-regular line-clamp-2 min-h-[32px] text-text-secondary"
          title={descriptionText}
        >
          {descriptionText}
        </p>
      </div>

      {/* Bottom Info Bar - Tags as icons */}
      <div className="mt-auto flex min-h-7 shrink-0 items-center gap-1 px-4 py-1">
        {tags && tags.length > 0 && (
          <>
            {visibleTags.map((tag, index) => (
              <div
                key={`${template_id}-tag-${index}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border-[0.5px] border-effects-icon-border bg-background-default-dodge"
                title={tag}
              >
                <span className="text-sm">{tag}</span>
              </div>
            ))}
            {remainingTagsCount > 0 && (
              <div className="flex items-center justify-center p-0.5">
                <span className="system-xs-regular text-text-tertiary">
                  +
                  {remainingTagsCount}
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
