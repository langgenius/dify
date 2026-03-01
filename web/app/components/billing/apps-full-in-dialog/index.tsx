'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import ProgressBar from '@/app/components/billing/progress-bar'
import { Plan } from '@/app/components/billing/type'
import { mailToSupport } from '@/app/components/header/utils/util'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import UpgradeBtn from '../upgrade-btn'
import s from './style.module.css'

const LOW = 50
const MIDDLE = 80

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
  const percent = usage / total * 100
  const color = (() => {
    if (percent < LOW)
      return 'bg-components-progress-bar-progress-solid'

    if (percent < MIDDLE)
      return 'bg-components-progress-warning-progress'

    return 'bg-components-progress-error-progress'
  })()
  return (
    <div className={cn(
      'flex flex-col gap-3 rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg p-4 shadow-xs backdrop-blur-sm',
      className,
    )}
    >
      <div className="flex justify-between">
        {!isTeam && (
          <div>
            <div className={cn('title-xl-semi-bold mb-1', s.textGradient)}>
              {t('apps.fullTip1', { ns: 'billing' })}
            </div>
            <div className="system-xs-regular text-text-tertiary">{t('apps.fullTip1des', { ns: 'billing' })}</div>
          </div>
        )}
        {isTeam && (
          <div>
            <div className={cn('title-xl-semi-bold mb-1', s.textGradient)}>
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
        <div className="system-xs-medium flex items-center justify-between text-text-secondary">
          <div>{t('usagePage.buildApps', { ns: 'billing' })}</div>
          <div>
            {usage}
            /
            {total}
          </div>
        </div>
        <ProgressBar
          percent={percent}
          color={color}
        />
      </div>
    </div>
  )
}
export default React.memo(AppsFull)
