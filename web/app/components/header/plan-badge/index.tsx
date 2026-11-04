import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import PremiumBadge from '../../base/premium-badge'

export function PlanBadge({ plan }: { plan: CloudPlan }) {
  switch (plan) {
    case 'sandbox':
      return (
        <PremiumBadge className="select-none" size="s" color="gray">
          <span className="p-1 system-2xs-medium-uppercase">{plan}</span>
        </PremiumBadge>
      )
    case 'professional':
      return (
        <PremiumBadge className="select-none" size="s" color="blue">
          <span className="p-1 system-2xs-medium-uppercase">pro</span>
        </PremiumBadge>
      )
    case 'team':
      return (
        <PremiumBadge className="select-none" size="s" color="indigo">
          <span className="p-1 system-2xs-medium-uppercase">{plan}</span>
        </PremiumBadge>
      )
  }
}
