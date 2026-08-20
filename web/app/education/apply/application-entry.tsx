'use client'

import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { redirect } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { isEducationPlanAvailable } from '../availability'
import EducationApplyPage from './application-form'

const selectEducationPlan = ({ billing, education }: GetFeaturesResponse) => ({
  enabled: education.enabled,
  plan: billing.subscription.plan,
})

export default function EducationApplyRoute({ token }: { token: string }) {
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const featuresQuery = useQuery(
    consoleQuery.features.get.queryOptions({ select: selectEducationPlan }),
  )

  if (featuresQuery.isPending) return null

  const educationPlan = featuresQuery.data
  if (
    !educationPlan ||
    !isEducationPlanAvailable({
      deploymentEdition,
      enabled: educationPlan.enabled,
    })
  )
    return redirect('/')

  return <EducationApplyPage token={token} plan={educationPlan.plan} />
}
