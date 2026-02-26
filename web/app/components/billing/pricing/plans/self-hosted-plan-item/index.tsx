'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Azure, GoogleCloud } from '@/app/components/base/icons/src/public/billing'
import { useAppContext } from '@/context/app-context'
import { cn } from '@/utils/classnames'
import Toast from '../../../../base/toast'
import { contactSalesUrl, getStartedWithCommunityUrl, getWithPremiumUrl } from '../../../config'
import { SelfHostedPlan } from '../../../type'
import { Community, Enterprise, EnterpriseNoise, Premium, PremiumNoise } from '../../assets'
import Button from './button'
import List from './list'

const STYLE_MAP = {
  [SelfHostedPlan.community]: {
    icon: <Community />,
    bg: '',
    noise: null,
  },
  [SelfHostedPlan.premium]: {
    icon: <Premium />,
    bg: 'bg-billing-plan-card-premium-bg opacity-10',
    noise: (
      <div className="absolute -top-12 left-0 right-0 -z-10">
        <PremiumNoise />
      </div>
    ),
  },
  [SelfHostedPlan.enterprise]: {
    icon: <Enterprise />,
    bg: 'bg-billing-plan-card-enterprise-bg opacity-10',
    noise: (
      <div className="absolute -top-12 left-0 right-0 -z-10">
        <EnterpriseNoise />
      </div>
    ),
  },
}

type SelfHostedPlanItemProps = {
  plan: SelfHostedPlan
}

const SelfHostedPlanItem: FC<SelfHostedPlanItemProps> = ({
  plan,
}) => {
  const { t } = useTranslation()
  const i18nPrefix = `plans.${plan}` as const
  const isFreePlan = plan === SelfHostedPlan.community
  const isPremiumPlan = plan === SelfHostedPlan.premium
  const isEnterprisePlan = plan === SelfHostedPlan.enterprise
  const { isCurrentWorkspaceManager } = useAppContext()

  const handleGetPayUrl = useCallback(() => {
    // Only workspace manager can buy plan
    if (!isCurrentWorkspaceManager) {
      Toast.notify({
        type: 'error',
        message: t('buyPermissionDeniedTip', { ns: 'billing' }),
        className: 'z-[1001]',
      })
      return
    }
    if (isFreePlan) {
      window.location.href = getStartedWithCommunityUrl
      return
    }
    if (isPremiumPlan) {
      window.location.href = getWithPremiumUrl
      return
    }

    if (isEnterprisePlan)
      window.location.href = contactSalesUrl
  }, [isCurrentWorkspaceManager, isFreePlan, isPremiumPlan, isEnterprisePlan, t])

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div className={cn('absolute inset-0 -z-10', STYLE_MAP[plan].bg)} />
      {/* Noise Effect */}
      {STYLE_MAP[plan].noise}
      <div className="flex flex-col px-5 py-4">
        <div className=" flex flex-col gap-y-6 px-1 pt-10">
          {STYLE_MAP[plan].icon}
          <div className="flex min-h-[104px] flex-col gap-y-2">
            <div className="text-[30px] font-medium leading-[1.2] text-text-primary">{t(`${i18nPrefix}.name`, { ns: 'billing' })}</div>
            <div className="system-md-regular line-clamp-2 text-text-secondary">{t(`${i18nPrefix}.description`, { ns: 'billing' })}</div>
          </div>
        </div>
        {/* Price */}
        <div className="flex items-end gap-x-2 px-1 pb-8 pt-4">
          <div className="title-4xl-semi-bold shrink-0 text-text-primary">{t(`${i18nPrefix}.price`, { ns: 'billing' })}</div>
          {!isFreePlan && (
            <span className="system-md-regular pb-0.5 text-text-tertiary">
              {t(`${i18nPrefix}.priceTip`, { ns: 'billing' })}
            </span>
          )}
        </div>
        <Button
          plan={plan}
          handleGetPayUrl={handleGetPayUrl}
        />
      </div>
      <List plan={plan} />
      {isPremiumPlan && (
        <div className="flex grow flex-col justify-end gap-y-2 p-6 pt-0">
          <div className="flex items-center gap-x-1">
            <div className="flex size-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default shadow-xs shadow-shadow-shadow-3">
              <Azure />
            </div>
            <div className="flex size-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default shadow-xs shadow-shadow-shadow-3">
              <GoogleCloud />
            </div>
          </div>
          <span className="system-xs-regular text-text-tertiary">
            {t('plans.premium.comingSoon', { ns: 'billing' })}
          </span>
        </div>
      )}
    </div>
  )
}
export default React.memo(SelfHostedPlanItem)
