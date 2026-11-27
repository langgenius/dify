'use client'

import type { ReactNode } from 'react'
import type { EvaluationResourceType } from '@/app/components/evaluation/types'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { Spinner } from '@langgenius/dify-ui/spinner'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import EvaluationUpgradePreview from '@/app/components/evaluation/upgrade-preview'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { getBillingErrorMessage } from './billing-error'

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
  const { t } = useTranslation(['billing', 'common'])
  const describeRequestError = useRequestErrorDescriber()
  const router = useRouter()
  const accessQuery = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features): EvaluationAccess =>
        features.evaluation_enabled
          ? 'enabled'
          : features.evaluation_upgrade_available
            ? 'upgrade'
            : 'unavailable',
    }),
  )
  const { data: access } = accessQuery
  const accessLoad = useOwnedQueryError(accessQuery)

  useEffect(() => {
    if (access === 'unavailable') router.replace(fallbackHref)
  }, [access, fallbackHref, router])

  if (accessLoad) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body p-4">
        <Alert type="error" className="w-full max-w-100">
          <AlertTitle>
            {getBillingErrorMessage(accessLoad.error, t, describeRequestError)}
          </AlertTitle>
          <AlertActions>
            <Button size="small" loading={accessLoad.retrying} onClick={accessLoad.retry}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </AlertActions>
        </Alert>
      </div>
    )
  }

  if (access === undefined) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Spinner aria-label={t(($) => $.loading, { ns: 'common' })} />
      </div>
    )
  }

  if (access === 'upgrade') return <EvaluationUpgradePreview resourceType={resourceType} />

  if (access === 'unavailable') return null

  return children
}

export default EvaluationPlanGuard
