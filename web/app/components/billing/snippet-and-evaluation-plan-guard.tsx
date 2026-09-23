'use client'

import type { ReactNode } from 'react'
import { Spinner } from '@langgenius/dify-ui/spinner'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { canAccessSnippetsAndEvaluation } from './utils'

type SnippetAndEvaluationPlanGuardProps = {
  children: ReactNode
  fallbackHref: string
}

const SnippetAndEvaluationPlanGuard = ({
  children,
  fallbackHref,
}: SnippetAndEvaluationPlanGuardProps) => {
  const { t } = useTranslation('common')
  const router = useRouter()
  const systemFeaturesQuery = useQuery(systemFeaturesQueryOptions())
  const deploymentEdition = systemFeaturesQuery.data?.deployment_edition
  const featuresQuery = useQuery({
    ...consoleQuery.features.get.queryOptions(),
    enabled: deploymentEdition === 'CLOUD',
  })
  const isReady =
    systemFeaturesQuery.isSuccess && (deploymentEdition !== 'CLOUD' || featuresQuery.isSuccess)
  const canAccess = deploymentEdition
    ? canAccessSnippetsAndEvaluation({
        deploymentEdition,
        planType: featuresQuery.data?.billing.subscription.plan,
      })
    : false

  useEffect(() => {
    if (isReady && !canAccess) router.replace(fallbackHref)
  }, [canAccess, fallbackHref, isReady, router])

  if (!isReady) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Spinner aria-label={t(($) => $.loading)} />
      </div>
    )
  }

  if (!canAccess) return null

  return children
}

export default SnippetAndEvaluationPlanGuard
