import Badge from '@/app/components/base/badge'
import { Plan } from '@/app/components/billing/type'
import { useProviderContext } from '@/context/provider-context'

type WorkspacePlanBadgeProps = {
  plan: Plan
}

const WorkspacePlanBadge = ({
  plan,
}: WorkspacePlanBadgeProps) => {
  const { isEducationWorkspace, isFetchedPlan } = useProviderContext()

  if (!isFetchedPlan)
    return null

  return (
    <Badge size="xs" variant="dimm" className="shrink-0">
      <span className="inline-flex items-center gap-1">
        {plan === Plan.professional && isEducationWorkspace && <span aria-hidden className="i-ri-graduation-cap-fill h-3 w-3" />}
        {plan === Plan.professional ? 'pro' : plan}
      </span>
    </Badge>
  )
}

export default WorkspacePlanBadge
