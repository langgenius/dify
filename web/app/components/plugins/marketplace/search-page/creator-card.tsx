'use client'

import type { Creator } from '../types'
import { useTranslation } from '#i18n'
import { getMarketplaceUrl } from '@/utils/var'
import { getCreatorAvatarUrl } from '../utils'

type CreatorCardProps = {
  creator: Creator
}

const CreatorCard = ({ creator }: CreatorCardProps) => {
  const { t } = useTranslation()
  const href = getMarketplaceUrl(`/creator/${creator.unique_handle}`)
  const displayName = creator.display_name || creator.name

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col gap-2 rounded-xl border border-components-panel-border-subtle bg-components-panel-bg p-4 transition-colors hover:bg-state-base-hover"
    >
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-components-panel-border-subtle bg-background-default-dodge">
          <img
            src={getCreatorAvatarUrl(creator.unique_handle)}
            alt={displayName}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="system-md-medium truncate text-text-primary">{displayName}</div>
          <div className="system-sm-regular text-text-tertiary">
            @
            {creator.unique_handle}
          </div>
        </div>
      </div>
      {!!creator.description && (
        <div className="system-sm-regular line-clamp-2 text-text-secondary">
          {creator.description}
        </div>
      )}
      {(creator.plugin_count !== undefined || creator.template_count !== undefined) && (
        <div className="system-xs-regular text-text-tertiary">
          {creator.plugin_count || 0}
          {' '}
          {t('plugins', { ns: 'plugin' }).toLowerCase()}
          {' · '}
          {creator.template_count || 0}
          {' '}
          {t('templates', { ns: 'plugin' }).toLowerCase()}
        </div>
      )}
    </a>
  )
}

export default CreatorCard
