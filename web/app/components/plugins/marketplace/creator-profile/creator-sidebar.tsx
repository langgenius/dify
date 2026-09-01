'use client'

import type { CreatorProfileViewModel, CreatorSocialPlatform } from './model'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'
import Partner from '@/app/components/plugins/base/badges/partner'
import Verified from '@/app/components/plugins/base/badges/verified'
import PublisherAvatar from './publisher-avatar'

type CreatorSidebarProps = {
  profile: CreatorProfileViewModel['profile']
}

function SocialIcon({ platform }: { platform: CreatorSocialPlatform }) {
  const className = 'size-4 shrink-0 text-text-tertiary'

  if (platform === 'x') return <span aria-hidden className={cn(className, 'i-ri-twitter-x-fill')} />
  if (platform === 'instagram')
    return <span aria-hidden className={cn(className, 'i-ri-instagram-line')} />
  if (platform === 'youtube')
    return <span aria-hidden className={cn(className, 'i-ri-youtube-fill')} />
  if (platform === 'figma') return <span aria-hidden className={cn(className, 'i-ri-figma-line')} />
  if (platform === 'github')
    return <span aria-hidden className={cn(className, 'i-ri-github-fill')} />

  return <span aria-hidden className={cn(className, 'i-ri-global-line')} />
}

export default function CreatorSidebar({ profile }: CreatorSidebarProps) {
  const { t } = useTranslation()
  const isOrganization = profile.kind === 'organization'
  const isPartner = profile.badges.includes('partner')
  const isVerified = profile.badges.includes('verified')

  return (
    <aside className="relative flex min-w-0 flex-col gap-4 pt-11 md:w-[234px] md:pt-12">
      <PublisherAvatar
        avatarUrl={profile.avatarUrl}
        name={profile.displayName}
        isOrganization={isOrganization}
        size={100}
        className={cn(
          'absolute -top-12 -left-2 z-10 !size-20 border-[1.5px] border-components-panel-bg bg-background-default-dodge shadow-xs md:-top-[68px] md:!size-[100px]',
          isOrganization && 'rounded-[10px]',
        )}
      />

      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <h1 className="title-2xl-semi-bold text-text-primary">{profile.displayName}</h1>
          {isOrganization && (
            <span className="rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.5 py-0.5 system-2xs-medium text-text-tertiary uppercase">
              {t(($) => $['marketplace.creatorProfile.organization'], { ns: 'plugin' })}
            </span>
          )}
          {isPartner && (
            <Partner
              className="size-[18px] shrink-0"
              text={t(($) => $['marketplace.partnerTip'], { ns: 'plugin' })}
            />
          )}
          {isVerified && (
            <Verified
              className="size-[18px] shrink-0"
              text={t(($) => $['marketplace.verifiedTip'], { ns: 'plugin' })}
            />
          )}
        </div>
        <span className="system-sm-regular text-text-tertiary">@{profile.handle}</span>
      </div>

      {profile.description && (
        <p className="system-sm-regular whitespace-pre-wrap text-text-secondary">
          {profile.description}
        </p>
      )}

      {profile.email && (
        <a
          href={`mailto:${profile.email}`}
          className="flex min-w-0 items-center gap-1.5 py-1 system-sm-regular text-text-secondary outline-hidden hover:text-text-accent focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span aria-hidden className="i-ri-mail-line size-4 shrink-0 text-text-tertiary" />
          <span className="truncate">{profile.email}</span>
        </a>
      )}

      {profile.socialLinks.length > 0 && (
        <div className="flex flex-col gap-2 py-1">
          <div className="flex w-full items-center gap-2">
            <span className="shrink-0 system-xs-medium text-text-tertiary uppercase">
              {t(($) => $['marketplace.creatorProfile.onTheWeb'], { ns: 'plugin' })}
            </span>
            <div className="h-px min-w-0 flex-1 bg-gradient-to-r from-divider-regular to-transparent" />
          </div>
          <div className="flex flex-col gap-2">
            {profile.socialLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-1.5 system-sm-regular text-text-secondary outline-hidden transition-colors hover:text-text-accent focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              >
                <SocialIcon platform={link.platform} />
                <span className="truncate">{link.label}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
