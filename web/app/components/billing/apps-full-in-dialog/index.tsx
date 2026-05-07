'use client'
import type { MeterTone } from '@langgenius/dify-ui/meter'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { MeterIndicator, MeterRoot, MeterTrack } from '@langgenius/dify-ui/meter'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Plan } from '@/app/components/billing/type'
import { mailToSupport } from '@/app/components/header/utils/util'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import UpgradeBtn from '../upgrade-btn'
import s from './style.module.css'

const AppsFull: FC<{ loc: string, className?: string }> = ({
  loc,
  className,
}) => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { userProfile, langGeniusVersionInfo } = useAppContext()
  const isTeam = plan.type === Plan.team
  const usage = plan.usage.buildApps
  const total = plan.total.buildApps
  const percent = total > 0 ? (usage / total) * 100 : 0
  const tone: MeterTone = percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'neutral'
  return (
    <div className={cn(
      'flex flex-col gap-3 rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-4 shadow-xs backdrop-blur-xs',
      className,
    )}
    >
      <div className="flex justify-between">
        {!isTeam && (
          <div>
            <div className={cn('mb-1 title-xl-semi-bold', s.textGradient)}>
              {t('apps.fullTip1', { ns: 'billing' })}
            </div>
            <div className="system-xs-regular text-text-tertiary">{t('apps.fullTip1des', { ns: 'billing' })}</div>
          </div>
        )}
        {isTeam && (
          <div>
            <div className={cn('mb-1 title-xl-semi-bold', s.textGradient)}>
              {t('apps.fullTip2', { ns: 'billing' })}
            </div>
            <div className="system-xs-regular text-text-tertiary">{t('apps.fullTip2des', { ns: 'billing' })}</div>
          </div>
        )}
        {(plan.type === Plan.sandbox || plan.type === Plan.professional) && (
          <UpgradeBtn isShort loc={loc} />
        )}
        {plan.type !== Plan.sandbox && plan.type !== Plan.professional && (
          <Button variant="secondary-accent">
            <a target="_blank" rel="noopener noreferrer" href={mailToSupport(userProfile.email, plan.type, langGeniusVersionInfo.current_version)}>
              {t('apps.contactUs', { ns: 'billing' })}
            </a>
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between system-xs-medium text-text-secondary">
          <div>{t('usagePage.buildApps', { ns: 'billing' })}</div>
          <div>
            {usage}
            /
            {total}
          </div>
        </div>
        <MeterRoot value={Math.min(percent, 100)} max={100}>
          <MeterTrack>
            <MeterIndicator tone={tone} />
          </MeterTrack>
        </MeterRoot>
      </div>
    </div>
  )
}
export default React.memo(AppsFull)
