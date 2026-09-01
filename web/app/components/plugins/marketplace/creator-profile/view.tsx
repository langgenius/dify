'use client'

import type { ReactNode } from 'react'
import type { CreatorCreation, CreatorCreationAction, CreatorProfileViewModel } from './model'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import Link from '@/next/link'
import DefaultCreatorBackground from './assets/default-background.png'
import CreatorContent from './creator-content'
import CreatorSidebar from './creator-sidebar'

export type CreatorProfileViewProps = {
  profile: CreatorProfileViewModel
  getCreationAction: (creation: CreatorCreation) => CreatorCreationAction
  header?: ReactNode
  homeHref: string
  isMarketplacePlatform: boolean
}

export default function CreatorProfileView({
  profile,
  getCreationAction,
  header,
  homeHref,
  isMarketplacePlatform,
}: CreatorProfileViewProps) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-full shrink-0 flex-col bg-background-default">
      {header}
      <main
        className={cn(
          'flex w-full flex-1 flex-col px-4',
          isMarketplacePlatform ? 'md:px-6' : 'md:px-9',
        )}
      >
        <nav
          aria-label={t(($) => $['marketplace.creatorProfile.breadcrumbLabel'], { ns: 'plugin' })}
          className="flex h-12 shrink-0 items-end gap-2 overflow-hidden"
        >
          <Link
            href={homeHref}
            aria-label={t(($) => $['marketplace.creatorProfile.home'], { ns: 'plugin' })}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <span aria-hidden className="i-ri-home-4-line size-4" />
          </Link>
          <span aria-hidden className="pb-0.5 system-md-regular text-text-quaternary">
            /
          </span>
          <span className="pb-0.5 system-md-regular text-text-primary">
            {t(($) => $['marketplace.creatorProfile.title'], { ns: 'plugin' })}
          </span>
        </nav>

        <div className="w-full pt-5 pb-8">
          <div
            className="relative h-40 w-full overflow-hidden rounded-xl border-0 bg-cover bg-center bg-no-repeat md:h-60"
            style={{ backgroundImage: `url("${DefaultCreatorBackground.src}")` }}
          >
            {profile.profile.backgroundUrl && (
              <img
                alt=""
                aria-hidden
                src={profile.profile.backgroundUrl}
                className="size-full border-0 object-cover object-center"
                onError={(event) => {
                  event.currentTarget.hidden = true
                }}
              />
            )}
          </div>

          <div
            className={cn(
              'grid min-w-0 grid-cols-1 gap-8 md:grid-cols-[234px_minmax(0,1fr)]',
              isMarketplacePlatform ? 'md:pl-4' : 'md:pl-9',
            )}
          >
            <CreatorSidebar profile={profile.profile} />
            <CreatorContent creations={profile.creations} getCreationAction={getCreationAction} />
          </div>
        </div>
      </main>
    </div>
  )
}
