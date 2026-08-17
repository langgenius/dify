'use client'

import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import { MARKETPLACE_URL_PREFIX } from '@/config'
import Link from '@/next/link'
import { useCreatorCenterUrl } from '../creator-center-url'

export default function HomeCreatorCenter() {
  const { t } = useTranslation('plugin')
  const creatorCenterUrl = useCreatorCenterUrl(MARKETPLACE_URL_PREFIX)
  const label = t(($) => $['marketplace.home.creatorCenter'])

  return (
    <Link
      href={creatorCenterUrl}
      target="_blank"
      rel="noopener noreferrer"
      // The visible text is hidden below the lg breakpoint, so the link needs
      // an explicit accessible name to avoid becoming an icon-only mystery.
      aria-label={label}
      className={cn(
        buttonVariants({ variant: 'ghost' }),
        'flex items-center gap-1 px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary [html[data-theme=dark]_&]:text-text-primary [html[data-theme=dark]_&]:hover:text-text-primary',
      )}
    >
      <span aria-hidden className="i-ri-user-star-line size-4" />
      <span className="hidden system-sm-medium lg:inline">{label}</span>
    </Link>
  )
}
