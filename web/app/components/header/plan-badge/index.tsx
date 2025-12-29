import type { FC } from 'react'
import {
  RiGraduationCapFill,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
import { SparklesSoft } from '../../base/icons/src/public/common'
import PremiumBadge from '../../base/premium-badge'
import { Plan } from '../../billing/type'

type PlanBadgeProps = {
  plan: Plan
  allowHover?: boolean
  sandboxAsUpgrade?: boolean
  onClick?: () => void
}

const PlanBadge: FC<PlanBadgeProps> = ({ plan, allowHover, sandboxAsUpgrade = false, onClick }) => {
  const { isFetchedPlan, isEducationWorkspace } = useProviderContext()
  const { t } = useTranslation()

  if (!isFetchedPlan)
    return null
  if (plan === Plan.sandbox && sandboxAsUpgrade) {
    return (
      <PremiumBadge className="select-none" color="blue" allowHover={allowHover} onClick={onClick}>
        <SparklesSoft className="flex h-3.5 w-3.5 items-center py-[1px] pl-[3px] text-components-premium-badge-indigo-text-stop-0" />
        <div className="system-xs-medium">
          <span className="whitespace-nowrap p-1">
            {t('upgradeBtn.encourageShort', { ns: 'billing' })}
          </span>
        </div>
      </PremiumBadge>
    )
  }
  if (plan === Plan.sandbox) {
    return (
      <PremiumBadge className="select-none" size="s" color="gray" allowHover={allowHover} onClick={onClick}>
        <div className="system-2xs-medium-uppercase">
          <span className="p-1">
            {plan}
          </span>
        </div>
      </PremiumBadge>
    )
  }
  if (plan === Plan.professional) {
    return (
      <PremiumBadge className="select-none" size="s" color="blue" allowHover={allowHover} onClick={onClick}>
        <div className="system-2xs-medium-uppercase">
          <span className="inline-flex items-center gap-1 p-1">
            {isEducationWorkspace && <RiGraduationCapFill className="h-3 w-3" />}
            pro
          </span>
        </div>
      </PremiumBadge>
    )
  }
  if (plan === Plan.team) {
    return (
      <PremiumBadge className="select-none" size="s" color="indigo" allowHover={allowHover} onClick={onClick}>
        <div className="system-2xs-medium-uppercase">
          <span className="p-1">
            {plan}
          </span>
        </div>
      </PremiumBadge>
    )
  }
  return null
}

export default PlanBadge
