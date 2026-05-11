import type { ReactNode } from 'react'
import {
  RiGraduationCapFill,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
import { SparklesSoft } from '../../base/icons/src/public/common'
import PremiumBadge, { PremiumBadgeButton } from '../../base/premium-badge'
import { Plan } from '../../billing/type'

type PlanBadgeProps = {
  plan: Plan
  allowHover?: boolean
  sandboxAsUpgrade?: boolean
  onClick?: () => void
}

function PlanBadgeShell({
  size,
  color,
  allowHover,
  onClick,
  children,
}: Pick<PlanBadgeProps, 'allowHover' | 'onClick'> & {
  size?: 's' | 'm'
  color: 'blue' | 'indigo' | 'gray'
  children: ReactNode
}) {
  if (onClick) {
    return (
      <PremiumBadgeButton className="select-none" size={size} color={color} allowHover={allowHover} onClick={onClick}>
        {children}
      </PremiumBadgeButton>
    )
  }

  return (
    <PremiumBadge className="select-none" size={size} color={color}>
      {children}
    </PremiumBadge>
  )
}

export function PlanBadge({ plan, allowHover, sandboxAsUpgrade = false, onClick }: PlanBadgeProps) {
  const { isFetchedPlan, isEducationWorkspace } = useProviderContext()
  const { t } = useTranslation()

  if (!isFetchedPlan)
    return null
  if (plan === Plan.sandbox && sandboxAsUpgrade) {
    return (
      <PlanBadgeShell color="blue" allowHover={allowHover} onClick={onClick}>
        <SparklesSoft aria-hidden="true" className="flex h-3.5 w-3.5 items-center py-px pl-[3px] text-components-premium-badge-indigo-text-stop-0" />
        <div className="system-xs-medium">
          <span className="p-1 whitespace-nowrap">
            {t('upgradeBtn.encourageShort', { ns: 'billing' })}
          </span>
        </div>
      </PlanBadgeShell>
    )
  }
  if (plan === Plan.sandbox) {
    return (
      <PlanBadgeShell size="s" color="gray" allowHover={allowHover} onClick={onClick}>
        <div className="system-2xs-medium-uppercase">
          <span className="p-1">
            {plan}
          </span>
        </div>
      </PlanBadgeShell>
    )
  }
  if (plan === Plan.professional) {
    return (
      <PlanBadgeShell size="s" color="blue" allowHover={allowHover} onClick={onClick}>
        <div className="system-2xs-medium-uppercase">
          <span className="inline-flex items-center gap-1 p-1">
            {isEducationWorkspace && <RiGraduationCapFill aria-hidden="true" className="h-3 w-3" />}
            pro
          </span>
        </div>
      </PlanBadgeShell>
    )
  }
  if (plan === Plan.team) {
    return (
      <PlanBadgeShell size="s" color="indigo" allowHover={allowHover} onClick={onClick}>
        <div className="system-2xs-medium-uppercase">
          <span className="p-1">
            {plan}
          </span>
        </div>
      </PlanBadgeShell>
    )
  }
  return null
}
