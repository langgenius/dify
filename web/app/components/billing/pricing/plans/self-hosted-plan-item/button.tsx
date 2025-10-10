import React, { useMemo } from 'react'
import { SelfHostedPlan } from '../../../type'
import { AwsMarketplaceDark, AwsMarketplaceLight } from '@/app/components/base/icons/src/public/billing'
import { RiArrowRightLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import { useTranslation } from 'react-i18next'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'

const BUTTON_CLASSNAME = {
  [SelfHostedPlan.community]: 'text-text-primary bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover',
  [SelfHostedPlan.premium]: 'text-background-default bg-saas-background-inverted hover:bg-saas-background-inverted-hover',
  [SelfHostedPlan.enterprise]: 'text-text-primary-on-surface bg-saas-dify-blue-static hover:bg-saas-dify-blue-static-hover',
}

type ButtonProps = {
  plan: SelfHostedPlan
  handleGetPayUrl: () => void
}

const Button = ({
  plan,
  handleGetPayUrl,
}: ButtonProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const i18nPrefix = `billing.plans.${plan}`
  const isPremiumPlan = plan === SelfHostedPlan.premium
  const AwsMarketplace = useMemo(() => {
    return theme === Theme.light ? AwsMarketplaceLight : AwsMarketplaceDark
  }, [theme])

  return (
    <button type="button"
      className={cn(
        'system-xl-semibold flex items-center gap-x-2 py-3 pl-5 pr-4',
        BUTTON_CLASSNAME[plan],
        isPremiumPlan && 'py-2',
      )}
      onClick={handleGetPayUrl}
    >
      <div className='flex grow items-center gap-x-2'>
        <span>{t(`${i18nPrefix}.btnText`)}</span>
        {isPremiumPlan && (
          <span className='pb-px pt-[7px]'>
            <AwsMarketplace className='h-6' />
          </span>
        )}
      </div>
      <RiArrowRightLine className='size-5 shrink-0' />
    </button>
  )
}

export default React.memo(Button)
