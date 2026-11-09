'use client'

import type { ReactNode } from 'react'
import { Spinner } from '@langgenius/dify-ui/spinner'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { useSnippetsAndEvaluationAccess } from './use-snippets-and-evaluation-access'

type SnippetAndEvaluationPlanGuardProps = {
  children: ReactNode
  fallbackHref: string
}

const SnippetAndEvaluationPlanGuard = ({
  children,
  fallbackHref,
}: SnippetAndEvaluationPlanGuardProps) => {
  const { t } = useTranslation(['common'])
  const router = useRouter()
  const { isReady, canAccess } = useSnippetsAndEvaluationAccess()

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
