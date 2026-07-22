import Badge from '@/app/components/base/badge'
import { Plan } from '@/app/components/billing/type'
import { PlanBadge } from '@/app/components/header/plan-badge'

type WorkspacePlanBadgeProps = {
  plan: Plan
}

const WorkspacePlanBadge = ({ plan }: WorkspacePlanBadgeProps) => {
  if (plan !== Plan.sandbox) return <PlanBadge plan={plan} />

  return (
    <Badge size="xs" variant="dimm" className="shrink-0">
      {plan}
    </Badge>
  )
}

export default WorkspacePlanBadge
