'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { useSnippetAndEvaluationPlanAccess } from '@/hooks/use-snippet-and-evaluation-plan-access'
import { useRouter } from '@/next/navigation'

type SnippetAndEvaluationPlanGuardProps = {
  children: ReactNode
  fallbackHref: string
}

const SnippetAndEvaluationPlanGuard = ({
  children,
  fallbackHref,
}: SnippetAndEvaluationPlanGuardProps) => {
  const router = useRouter()
  const { canAccess, isReady } = useSnippetAndEvaluationPlanAccess()

  useEffect(() => {
    if (isReady && !canAccess)
      router.replace(fallbackHref)
  }, [canAccess, fallbackHref, isReady, router])

  if (!isReady) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }

  if (!canAccess)
    return null

  return <>{children}</>
}

export default SnippetAndEvaluationPlanGuard
