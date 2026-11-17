'use client'

import { Alert, AlertActions, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'

export function SuspensionNotice({
  appId,
  environmentId,
  accessPoint = false,
  canDeploy = true,
  className,
}: {
  appId?: string
  environmentId: string
  accessPoint?: boolean
  canDeploy?: boolean
  className?: string
}) {
  const { t } = useTranslation(['deployments'])
  const { data } = useQuery(
    consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
    }),
  )
  const suspended = data?.data.some(
    (environment) => environment.id === environmentId && environment.suspended_at,
  )
  if (!suspended || !appId) return null

  return (
    <div className={className}>
      <Alert type="warning">
        <AlertTitle>{t(($) => $['studio.pauseNotice.title'])}</AlertTitle>
        <AlertDescription>
          {accessPoint
            ? t(($) => $['studio.pauseNotice.accessPoint'])
            : t(($) => $['studio.pauseNotice.deploy'])}
        </AlertDescription>
        {canDeploy && (
          <AlertActions>
            <Link
              href={`/app/${appId}/deploy`}
              className={cn(buttonVariants({ size: 'small', variant: 'secondary' }), 'mt-1 gap-1')}
            >
              {t(($) => $['studio.pauseNotice.goToDeploy'])}
              <span aria-hidden className="i-ri-arrow-right-line size-3" />
            </Link>
          </AlertActions>
        )}
      </Alert>
    </div>
  )
}
