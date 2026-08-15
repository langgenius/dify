'use client'

import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import { useQuery } from '@tanstack/react-query'
import { redirect } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import EducationApplyPage from './application-form'

const selectEducationPlan = ({ billing, education }: GetFeaturesResponse) => ({
  enabled: education.enabled,
  plan: billing.subscription.plan,
})

export default function EducationApplyRoute({ token }: { token: string }) {
  const featuresQuery = useQuery(
    consoleQuery.features.get.queryOptions({ select: selectEducationPlan }),
  )

  if (featuresQuery.isPending) return null

  if (!featuresQuery.data?.enabled) return redirect('/')

  return <EducationApplyPage token={token} plan={featuresQuery.data.plan} />
}
