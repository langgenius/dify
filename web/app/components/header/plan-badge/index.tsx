import { useProviderContext } from '@/context/provider-context'
import classNames from '@/utils/classnames'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { SparklesSoft } from '../../base/icons/src/public/common'
import PremiumBadge from '../../base/premium-badge'
import { Plan } from '../../billing/type'

type PlanBadgeProps = {
  plan: Plan
  size?: 's' | 'm'
  allowHover?: boolean
  sandboxAsUpgrade?: boolean
  onClick?: () => void
}

const PlanBadge: FC<PlanBadgeProps> = ({ plan, allowHover, size = 'm', sandboxAsUpgrade = false, onClick }) => {
  const { isFetchedPlan } = useProviderContext()
  const { t } = useTranslation()

  if (!isFetchedPlan) return null
  if (plan === Plan.sandbox && sandboxAsUpgrade) {
    return <div className='select-none'>
      <PremiumBadge color='blue' allowHover={allowHover} onClick={onClick}>
        <SparklesSoft className='flex items-center py-[1px] pl-[3px] w-3.5 h-3.5 text-components-premium-badge-indigo-text-stop-0' />
        <div className='system-xs-medium'>
          <span className='p-1'>
            {t('billing.upgradeBtn.encourageShort')}
          </span>
        </div>
      </PremiumBadge>
    </div>
  }
  if (plan === Plan.sandbox) {
    return <div className='select-none'>
      <PremiumBadge size={size} color='gray' allowHover={allowHover} onClick={onClick}>
        <div className={classNames(size === 's' ? 'system-2xs-medium-uppercase' : 'system-xs-medium-uppercase')}>
          <span className='p-1'>
            {plan}
          </span>
        </div>
      </PremiumBadge>
    </div>
  }
  if (plan === Plan.professional) {
    return <div className='select-none'>
      <PremiumBadge size={size} color='blue' allowHover={allowHover} onClick={onClick}>
        <div className={classNames(size === 's' ? 'system-2xs-medium-uppercase' : 'system-xs-medium-uppercase')}>
          <span className='p-1'>
            pro
          </span>
        </div>
      </PremiumBadge>
    </div>
  }
  if (plan === Plan.team) {
    return <div className='select-none'>
      <PremiumBadge size={size} color='indigo' allowHover={allowHover} onClick={onClick}>
        <div className={classNames(size === 's' ? 'system-2xs-medium-uppercase' : 'system-xs-medium-uppercase')}>
          <span className='p-1'>
            {plan}
          </span>
        </div>
      </PremiumBadge>
    </div>
  }
  return null
}

export default PlanBadge
