'use client'
import type { SelfHostedPlan } from '../../../config'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import AwsMarketplaceDark from '@/app/components/base/icons/src/public/billing/AwsMarketplaceDark'
import AwsMarketplaceLight from '@/app/components/base/icons/src/public/billing/AwsMarketplaceLight'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { SELF_HOSTED_PLAN_URLS } from '../../../config'
import Community from '../../assets/community'
import Enterprise from '../../assets/enterprise'
import EnterpriseNoise from '../../assets/enterprise-noise'
import Premium from '../../assets/premium'
import PremiumNoise from '../../assets/premium-noise'
import { SelfHostedPlanFeatures } from './list'

const STYLE_MAP = {
  community: {
    icon: <Community />,
    bg: '',
    noise: null,
  },
  premium: {
    icon: <Premium />,
    bg: 'bg-billing-plan-card-premium-bg opacity-10',
    noise: (
      <div className="absolute inset-x-0 -top-12 -z-10">
        <PremiumNoise />
      </div>
    ),
  },
  enterprise: {
    icon: <Enterprise />,
    bg: 'bg-billing-plan-card-enterprise-bg opacity-10',
    noise: (
      <div className="absolute inset-x-0 -top-12 -z-10">
        <EnterpriseNoise />
      </div>
    ),
  },
}

export function SelfHostedPlanItem({ plan }: { plan: SelfHostedPlan }) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const i18nPrefix = `plans.${plan}` as const
  const isFreePlan = plan === 'community'
  const isPremiumPlan = plan === 'premium'

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div className={cn('absolute inset-0 -z-10', STYLE_MAP[plan].bg)} />
      {/* Noise Effect */}
      {STYLE_MAP[plan].noise}
      <div className="flex flex-col px-5 py-4">
        <div className="flex flex-col gap-y-6 px-1 pt-10">
          {STYLE_MAP[plan].icon}
          <div className="flex min-h-26 flex-col gap-y-2">
            <h3 className="text-[30px] leading-[1.2] font-medium text-text-primary">
              {t(($) => $[`${i18nPrefix}.name`], { ns: 'billing' })}
            </h3>
            <div
              className="line-clamp-2 system-md-regular text-text-secondary"
              title={t(($) => $[`${i18nPrefix}.description`], { ns: 'billing' })}
            >
              {t(($) => $[`${i18nPrefix}.description`], { ns: 'billing' })}
            </div>
          </div>
        </div>
        {/* Price */}
        <div className="flex items-end gap-x-2 px-1 pt-4 pb-8">
          <div className="shrink-0 title-4xl-semi-bold text-text-primary">
            {t(($) => $[`${i18nPrefix}.price`], { ns: 'billing' })}
          </div>
          {!isFreePlan && (
            <span className="pb-0.5 system-md-regular text-text-tertiary">
              {t(($) => $[`${i18nPrefix}.priceTip`], { ns: 'billing' })}
            </span>
          )}
        </div>
        <a
          href={SELF_HOSTED_PLAN_URLS[plan]}
          data-plan={plan}
          className={cn(
            buttonVariants({ variant: 'tertiary', size: null }),
            'h-12 w-full justify-start gap-x-2 rounded-none bg-components-button-tertiary-bg py-3 pr-4 pl-5 system-xl-semibold text-text-primary hover:bg-components-button-tertiary-bg-hover data-[plan=enterprise]:bg-saas-dify-blue-static data-[plan=enterprise]:text-text-primary-on-surface data-[plan=enterprise]:hover:bg-saas-dify-blue-static-hover data-[plan=premium]:bg-saas-background-inverted data-[plan=premium]:py-2 data-[plan=premium]:text-background-default data-[plan=premium]:hover:bg-saas-background-inverted-hover',
          )}
        >
          <span className="flex grow items-center gap-x-2">
            <span>{t(($) => $[`${i18nPrefix}.btnText`], { ns: 'billing' })}</span>
            {isPremiumPlan && (
              <span aria-hidden className="pt-1.75 pb-px">
                {theme === Theme.light ? (
                  <AwsMarketplaceLight className="h-6" />
                ) : (
                  <AwsMarketplaceDark className="h-6" />
                )}
              </span>
            )}
          </span>
          <span aria-hidden className="i-ri-arrow-right-line size-5 shrink-0" />
        </a>
      </div>
      <SelfHostedPlanFeatures plan={plan} />
      {isPremiumPlan && (
        <div className="flex grow flex-col justify-end gap-y-2 p-6 pt-0">
          <div className="flex items-center gap-x-1">
            <div className="flex size-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default shadow-xs shadow-shadow-shadow-3">
              <span aria-hidden className="i-custom-public-billing-azure h-5 w-[21px]" />
            </div>
            <div className="flex size-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default shadow-xs shadow-shadow-shadow-3">
              <span
                aria-hidden
                className="i-custom-public-billing-google-cloud h-[18px] w-[22px]"
              />
            </div>
          </div>
          <span className="system-xs-regular text-text-tertiary">
            {t(($) => $['plans.premium.comingSoon'], { ns: 'billing' })}
          </span>
        </div>
      )}
    </div>
  )
}
