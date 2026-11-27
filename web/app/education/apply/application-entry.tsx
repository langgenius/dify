'use client'

import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getBillingErrorMessage } from '@/app/components/billing/billing-error'
import { redirect } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import EducationApplyPage from './application-form'

const selectEducationPlan = ({ billing, education }: GetFeaturesResponse) => ({
  enabled: education.enabled,
  plan: billing.subscription.plan,
})

export default function EducationApplyRoute({ token }: { token: string }) {
  const { t } = useTranslation(['billing', 'common'])
  const describeRequestError = useRequestErrorDescriber()
  const featuresQuery = useQuery(
    consoleQuery.features.get.queryOptions({
      select: selectEducationPlan,
    }),
  )

  const featuresLoad = useOwnedQueryError(featuresQuery)

  if (featuresQuery.isPending) return null

  if (featuresLoad) {
    return (
      <Alert type="error">
        <AlertTitle>
          {getBillingErrorMessage(featuresLoad.error, t, describeRequestError)}
        </AlertTitle>
        <AlertActions>
          <Button size="small" loading={featuresLoad.retrying} onClick={featuresLoad.retry}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </AlertActions>
      </Alert>
    )
  }

  if (!featuresQuery.data?.enabled) return redirect('/')

  return <EducationApplyPage token={token} plan={featuresQuery.data.plan} />
}
