'use client'

import type { ReactNode } from 'react'
import { Spinner } from '@langgenius/dify-ui/spinner'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

type EvaluationPlanGuardProps = {
  children: ReactNode
  fallbackHref: string
}

const EvaluationPlanGuard = ({ children, fallbackHref }: EvaluationPlanGuardProps) => {
  const { t } = useTranslation(['common'])
  const router = useRouter()
  const { data: canUseEvaluation } = useQuery(
    consoleQuery.features.get.queryOptions({ select: (features) => features.evaluation_enabled }),
  )

  useEffect(() => {
    if (canUseEvaluation === false) router.replace(fallbackHref)
  }, [canUseEvaluation, fallbackHref, router])

  if (canUseEvaluation === undefined) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Spinner aria-label={t(($) => $.loading)} />
      </div>
    )
  }

  if (!canUseEvaluation) return null

  return children
}

export default EvaluationPlanGuard
