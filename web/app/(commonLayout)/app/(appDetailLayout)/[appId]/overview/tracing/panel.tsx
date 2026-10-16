'use client'

import type { AppTracePayload } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import type { ProviderConfigError } from './provider-panel'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Separator } from '@langgenius/dify-ui/separator'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import ConfigButton from './config-button'
import providerIcons from './provider-icons.module.css'
import TracingIcon from './tracing-icon'
import { TracingProvider } from './type'

const I18N_PREFIX = 'tracing'

type PanelProps = {
  appId: string
  readOnly: boolean
}

const Panel: FC<PanelProps> = ({ appId, readOnly }) => {
  const { t } = useTranslation(['app', 'common'])
  const statusQuery = useQuery(
    consoleQuery.apps.byAppId.trace.get.queryOptions({
      input: { params: { app_id: appId } },
    }),
  )
  const tracingStatus = statusQuery.data
  const providers = Object.values(TracingProvider)
  const configQueries = useQueries({
    queries: providers.map((provider) =>
      consoleQuery.apps.byAppId.traceConfig.get.queryOptions({
        input: { params: { app_id: appId }, query: { tracing_provider: provider } },
      }),
    ),
  })
  const configs = new Map(
    providers.map((provider, index) => {
      const response = configQueries[index]?.data
      return [
        provider,
        response?.has_not_configured ? null : (response?.tracing_config ?? null),
      ] as const
    }),
  )
  const { mutate: updateTracingStatus } = useMutation(
    consoleQuery.apps.byAppId.trace.post.mutationOptions(),
  )
  const enabled = tracingStatus?.enabled ?? false
  const inUseTracingProvider =
    providers.find((provider) => provider === tracingStatus?.tracing_provider) ?? null
  const handleTracingStatusChange = (body: AppTracePayload, noToast = false) => {
    updateTracingStatus(
      { params: { app_id: appId }, body },
      {
        onSuccess: () => {
          if (!noToast)
            toast(
              t(($) => $['api.success'], { ns: 'common' }),
              { type: 'success' },
            )
        },
      },
    )
  }
  const handleTracingEnabledChange = (enabled: boolean) => {
    handleTracingStatusChange({ tracing_provider: inUseTracingProvider, enabled })
  }
  const handleChooseProvider = (provider: TracingProvider) => {
    handleTracingStatusChange({ tracing_provider: provider, enabled: true })
  }
  const providerIconClassMap: Record<TracingProvider, string> = {
    [TracingProvider.arize]: cn(providerIcons.arize, 'w-18.5'),
    [TracingProvider.phoenix]: cn(providerIcons.phoenix, 'w-18.5'),
    [TracingProvider.langSmith]: cn(providerIcons.langsmith, 'w-21'),
    [TracingProvider.langfuse]: cn(providerIcons.langfuse, 'w-18.5'),
    [TracingProvider.opik]: cn(providerIcons.opik, 'w-[47.133904px]'),
    [TracingProvider.weave]: cn(providerIcons.weave, 'w-30'),
    [TracingProvider.aliyun]: cn(providerIcons.aliyun, 'w-16.25'),
    [TracingProvider.mlflow]: cn(providerIcons.mlflow, 'w-11'),
    [TracingProvider.databricks]: cn(providerIcons.databricks, 'w-25'),
    [TracingProvider.tencent]: cn(providerIcons.tencent, 'w-20'),
  }
  const inUseProviderIconClassName = inUseTracingProvider
    ? providerIconClassMap[inUseTracingProvider]
    : undefined

  const hasConfiguredTracing =
    !!inUseTracingProvider || [...configs.values()].some((config) => config !== null)
  const handleTracingConfigRemoved = (provider: TracingProvider) => {
    if (provider === inUseTracingProvider) {
      handleTracingStatusChange({ enabled: false, tracing_provider: null }, true)
    }
  }

  const configErrors: Partial<Record<TracingProvider, ProviderConfigError>> = {}
  configQueries.forEach((query, index) => {
    const provider = providers[index]
    if (provider && query.isFetched && !query.data) {
      configErrors[provider] = {
        onRetry: () => {
          void query.refetch()
        },
        isRetrying: query.isFetching,
      }
    }
  })
  const statusFailed = statusQuery.isError && !tracingStatus
  if (statusFailed) {
    return (
      <Button
        variant="secondary"
        disabled={statusQuery.isFetching}
        onClick={() => {
          void statusQuery.refetch()
        }}
      >
        {t(($) => $['tracing.title'], { ns: 'app' })}
        {' · '}
        {t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
      </Button>
    )
  }
  const isLoading =
    statusQuery.isPending || configQueries.some((query) => query.isPending && !query.isFetched)

  return (
    <div className={cn('flex items-center justify-between')}>
      <ConfigButton
        key={appId}
        appId={appId}
        readOnly={readOnly}
        disabled={isLoading}
        hasConfigured={hasConfiguredTracing}
        enabled={enabled}
        onStatusChange={handleTracingEnabledChange}
        chosenProvider={inUseTracingProvider}
        onChooseProvider={handleChooseProvider}
        arizeConfig={configs.get(TracingProvider.arize)}
        phoenixConfig={configs.get(TracingProvider.phoenix)}
        langSmithConfig={configs.get(TracingProvider.langSmith)}
        langFuseConfig={configs.get(TracingProvider.langfuse)}
        opikConfig={configs.get(TracingProvider.opik)}
        weaveConfig={configs.get(TracingProvider.weave)}
        aliyunConfig={configs.get(TracingProvider.aliyun)}
        mlflowConfig={configs.get(TracingProvider.mlflow)}
        databricksConfig={configs.get(TracingProvider.databricks)}
        tencentConfig={configs.get(TracingProvider.tencent)}
        configErrors={configErrors}
        onConfigRemoved={handleTracingConfigRemoved}
      >
        {!isLoading && hasConfiguredTracing ? (
          <>
            <span className="mr-1 ml-4 flex items-center">
              <StatusDot status={enabled ? 'success' : 'disabled'} />
              <span className="ml-1.5 system-xs-semibold-uppercase text-text-tertiary">
                {t(($) => $[`${I18N_PREFIX}.${enabled ? 'enabled' : 'disabled'}`], { ns: 'app' })}
              </span>
            </span>
            {inUseProviderIconClassName && (
              <span aria-hidden className={cn(inUseProviderIconClassName, 'ml-1 h-4')} />
            )}
            <span className="ml-2 rounded-md p-1">
              <span className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            </span>
            <Separator decorative orientation="vertical" className="mx-2 h-3.5" />
          </>
        ) : (
          <>
            <TracingIcon size="md" />
            <span className="mx-2 system-sm-semibold text-text-secondary">
              {t(($) => $[`${I18N_PREFIX}.title`], { ns: 'app' })}
            </span>
            <span className="rounded-md p-1">
              <span className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            </span>
            <Separator decorative orientation="vertical" className="mx-2 h-3.5" />
            <span className="rounded-md p-1">
              <span className="i-ri-arrow-down-double-line size-4 text-text-tertiary" />
            </span>
          </>
        )}
      </ConfigButton>
    </div>
  )
}
export default React.memo(Panel)
