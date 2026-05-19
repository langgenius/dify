'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { useSnippetPlanAccess } from '@/hooks/use-snippet-plan-access'
import { useRouter } from '@/next/navigation'

type SnippetPlanGuardProps = {
  children: ReactNode
  fallbackHref: string
}

const SnippetPlanGuard = ({
  children,
  fallbackHref,
}: SnippetPlanGuardProps) => {
  const router = useRouter()
  const { canAccess, isReady } = useSnippetPlanAccess()

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

export default SnippetPlanGuard
