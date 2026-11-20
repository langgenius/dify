'use client'

import type { ReactNode } from 'react'
import { Spinner } from '@langgenius/dify-ui/spinner'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { useEvaluationAccess } from './use-evaluation-access'

type EvaluationPlanGuardProps = {
  children: ReactNode
  fallbackHref: string
}

const EvaluationPlanGuard = ({ children, fallbackHref }: EvaluationPlanGuardProps) => {
  const { t } = useTranslation(['common'])
  const router = useRouter()
  const { isReady, canAccess } = useEvaluationAccess()

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

export default EvaluationPlanGuard
