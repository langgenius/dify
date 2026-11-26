'use client'

import type { ReactNode } from 'react'
import type { EvaluationResourceType } from '@/app/components/evaluation/types'
import { Spinner } from '@langgenius/dify-ui/spinner'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import EvaluationUpgradePreview from '@/app/components/evaluation/upgrade-preview'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

type EvaluationPlanGuardProps = {
  children: ReactNode
  fallbackHref: string
  /** Picks the sample shown when the workspace can unlock Evaluation by upgrading. */
  resourceType: EvaluationResourceType
}

type EvaluationAccess = 'enabled' | 'upgrade' | 'unavailable'

const EvaluationPlanGuard = ({
  children,
  fallbackHref,
  resourceType,
}: EvaluationPlanGuardProps) => {
  const { t } = useTranslation(['common'])
  const router = useRouter()
  const { data: access } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features): EvaluationAccess =>
        features.evaluation_enabled
          ? 'enabled'
          : features.evaluation_upgrade_available
            ? 'upgrade'
            : 'unavailable',
    }),
  )

  useEffect(() => {
    if (access === 'unavailable') router.replace(fallbackHref)
  }, [access, fallbackHref, router])

  if (access === undefined) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Spinner aria-label={t(($) => $.loading)} />
      </div>
    )
  }

  if (access === 'upgrade') return <EvaluationUpgradePreview resourceType={resourceType} />

  if (access === 'unavailable') return null

  return children
}

export default EvaluationPlanGuard
