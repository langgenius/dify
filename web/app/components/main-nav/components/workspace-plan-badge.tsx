import type { CloudPlan } from '@dify/contracts/api/console/workspaces/types.gen'
import Badge from '@/app/components/base/badge'
import { PlanBadge } from '@/app/components/header/plan-badge'

type WorkspacePlanBadgeProps = {
  plan: CloudPlan
}

const WorkspacePlanBadge = ({ plan }: WorkspacePlanBadgeProps) => {
  if (plan !== 'sandbox') return <PlanBadge plan={plan} />

  return (
    <Badge size="xs" variant="dimm" className="shrink-0">
      {plan}
    </Badge>
  )
}

export default WorkspacePlanBadge
