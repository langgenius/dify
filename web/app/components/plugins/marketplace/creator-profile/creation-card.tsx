'use client'

import type { CreatorCreation, CreatorCreationAction } from './model'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import AppIcon from '@/app/components/base/app-icon'
import CornerMark from '@/app/components/plugins/card/base/corner-mark'
import Link from '@/next/link'

const MAX_VISIBLE_DEPENDENCIES = 7

type CreationCardProps = {
  creation: CreatorCreation
  action: CreatorCreationAction
}

const cardClassName =
  'group relative flex h-[152px] min-w-0 w-full flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 text-left shadow-xs outline-hidden transition-shadow hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-md focus-visible:ring-2 focus-visible:ring-state-accent-solid'

function CreationCardContent({ creation }: { creation: CreatorCreation }) {
  const { t } = useTranslation()
  const visibleDependencies = creation.dependencyIcons.slice(0, MAX_VISIBLE_DEPENDENCIES)
  const remainingDependencies = Math.max(0, creation.dependencyCount - visibleDependencies.length)

  return (
    <>
      <CornerMark
        text={t(($) => $[`marketplace.creatorProfile.type.${creation.kind}`], { ns: 'plugin' })}
        className={cn(
          creation.kind === 'plugin' && '[&>div]:text-text-accent',
          creation.kind === 'template' && '[&>div]:text-text-warning',
        )}
      />

      <div className="flex min-w-0 shrink-0 items-center gap-3 px-4 pt-4 pr-20 pb-2">
        {creation.icon.type === 'image' ? (
          <AppIcon size="large" iconType="image" imageUrl={creation.icon.src} />
        ) : (
          <AppIcon
            size="large"
            iconType="emoji"
            icon={creation.icon.value}
            background={creation.icon.background}
          />
        )}
        <h3 className="min-w-0 flex-1 truncate system-md-medium text-text-primary">
          {creation.title}
        </h3>
      </div>

      <p className="mx-4 line-clamp-2 min-h-8 system-xs-regular text-text-secondary">
        {creation.description}
      </p>

      <div className="mt-auto flex min-h-7 items-center gap-1 overflow-hidden px-4 py-1">
        {visibleDependencies.map((icon) => (
          <img
            key={icon}
            alt=""
            aria-hidden
            src={icon}
            className="size-6 shrink-0 rounded-md border-[0.5px] border-effects-icon-border object-cover"
          />
        ))}
        {remainingDependencies > 0 && (
          <span className="shrink-0 system-xs-regular text-text-tertiary">
            +{remainingDependencies}
          </span>
        )}
      </div>
    </>
  )
}

export default function CreationCard({ creation, action }: CreationCardProps) {
  if (action.type === 'link') {
    return (
      <Link href={action.href} aria-label={creation.title} className={cardClassName}>
        <CreationCardContent creation={creation} />
      </Link>
    )
  }

  return (
    <button
      type="button"
      aria-label={creation.title}
      className={cardClassName}
      onClick={action.onSelect}
    >
      <CreationCardContent creation={creation} />
    </button>
  )
}
