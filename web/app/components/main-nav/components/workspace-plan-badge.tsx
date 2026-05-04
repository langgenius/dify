import Badge from '@/app/components/base/badge'
import { Plan } from '@/app/components/billing/type'

type WorkspacePlanBadgeProps = {
  plan: Plan
}

const WorkspacePlanBadge = ({
  plan,
}: WorkspacePlanBadgeProps) => {
  return (
    <Badge size="xs" variant="dimm" className="shrink-0">
      {plan === Plan.professional ? 'pro' : plan}
    </Badge>
  )
}

export default WorkspacePlanBadge
