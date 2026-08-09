'use client'

import type { AppEnvironment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { EnvironmentDeployMenu } from '../deploy-menu'
import { EmptyTableSkeleton } from './skeleton'

type EnvironmentTableEmptyProps =
  | {
      state: 'empty'
      onSelectEnvironment?: (environment: AppEnvironment) => void
    }
  | {
      state: 'error'
      isRetrying: boolean
      onRetry: () => void
    }

export function EnvironmentTableEmpty(props: EnvironmentTableEmptyProps) {
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
  const isError = props.state === 'error'
  const title = isError ? tCommon(($) => $['errorBoundary.title']) : t(($) => $['list.emptyTitle'])
  const description = isError
    ? t(($) => $['common.loadFailed'])
    : t(($) => $['studio.emptyDescription'])

  return (
    <div className="relative h-full w-full min-w-0 overflow-hidden">
      <EmptyTableSkeleton />
      <div className="absolute inset-0 z-20 flex items-center justify-center p-2">
        <div className="flex w-full max-w-120 flex-col items-center justify-center gap-3 pt-6 pb-16">
          <div className="flex size-14 items-center justify-center rounded-[10px]">
            <div className="flex size-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1">
              <span aria-hidden className="i-ri-instance-line size-6 text-text-tertiary" />
            </div>
          </div>
          <div className="flex w-full flex-col items-center gap-2">
            <h3 className="system-md-medium text-text-secondary">{title}</h3>
            <p className="system-sm-regular text-text-tertiary">{description}</p>
          </div>
          {props.state === 'error' ? (
            <Button variant="secondary" loading={props.isRetrying} onClick={props.onRetry}>
              <span aria-hidden className="mr-1.5 i-ri-reset-left-line" />
              {tCommon(($) => $['operation.retry'])}
            </Button>
          ) : (
            <EnvironmentDeployMenu
              appearance="empty"
              onSelectEnvironment={props.onSelectEnvironment}
            />
          )}
        </div>
      </div>
    </div>
  )
}
