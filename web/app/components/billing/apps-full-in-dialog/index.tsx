'use client'
import type { MeterTone } from '@langgenius/dify-ui/meter'
import type { FC } from 'react'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Meter, MeterIndicator, MeterTrack } from '@langgenius/dify-ui/meter'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { mailToSupport } from '@/app/components/header/utils/util'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/client'
import UpgradeBtn from '../upgrade-btn'
import s from './style.module.css'

const AppsFull: FC<{ loc: string; className?: string }> = ({ loc, className }) => {
  const { t } = useTranslation()
  const { data: billing } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (data) => ({ plan: data.billing.subscription.plan, apps: data.apps }),
    }),
  )
  const { data: accountProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => ({
      email: data.profile.email,
      currentVersion: data.meta.currentVersion,
    }),
  })
  if (!billing) return null
  const isTeam = billing.plan === 'team'
  const usage = billing.apps.size
  const total = billing.apps.limit
  const percent = total > 0 ? (usage / total) * 100 : 0
  const tone: MeterTone = percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'neutral'
  const buildAppsLabel = t(($) => $['usagePage.buildApps'], { ns: 'billing' })
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-4 shadow-xs backdrop-blur-xs',
        className,
      )}
    >
      <div className="flex justify-between">
        {!isTeam && (
          <div>
            <div className={cn('mb-1 title-xl-semi-bold', s.textGradient)}>
              {t(($) => $['apps.fullTip1'], { ns: 'billing' })}
            </div>
            <div className="system-xs-regular text-text-tertiary">
              {t(($) => $['apps.fullTip1des'], { ns: 'billing' })}
            </div>
          </div>
        )}
        {isTeam && (
          <div>
            <div className={cn('mb-1 title-xl-semi-bold', s.textGradient)}>
              {t(($) => $['apps.fullTip2'], { ns: 'billing' })}
            </div>
            <div className="system-xs-regular text-text-tertiary">
              {t(($) => $['apps.fullTip2des'], { ns: 'billing' })}
            </div>
          </div>
        )}
        {(billing.plan === 'sandbox' || billing.plan === 'professional') && (
          <UpgradeBtn isShort loc={loc} />
        )}
        {billing.plan !== 'sandbox' && billing.plan !== 'professional' && (
          <a
            target="_blank"
            rel="noopener noreferrer"
            href={mailToSupport(
              accountProfile.email,
              billing.plan,
              accountProfile.currentVersion ?? '',
            )}
            className={buttonVariants({ variant: 'secondary-accent' })}
          >
            {t(($) => $['apps.contactUs'], { ns: 'billing' })}
          </a>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between system-xs-medium text-text-secondary">
          <div>{buildAppsLabel}</div>
          <div>
            {usage}/{total}
          </div>
        </div>
        <Meter value={Math.min(percent, 100)} max={100} aria-label={buildAppsLabel}>
          <MeterTrack>
            <MeterIndicator tone={tone} />
          </MeterTrack>
        </Meter>
      </div>
    </div>
  )
}
export default React.memo(AppsFull)
