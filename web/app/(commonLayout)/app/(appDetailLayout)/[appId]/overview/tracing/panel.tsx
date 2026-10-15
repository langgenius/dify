'use client'

import type { AppTracePayload } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
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
    [TracingProvider.arize]: 'i-custom-public-tracing-arize-icon w-18.5',
    [TracingProvider.phoenix]: 'i-custom-public-tracing-phoenix-icon w-18.5',
    [TracingProvider.langSmith]: 'i-custom-public-tracing-langsmith-icon w-21',
    [TracingProvider.langfuse]: 'i-custom-public-tracing-langfuse-icon w-18.5',
    [TracingProvider.opik]: 'i-custom-public-tracing-opik-icon w-[47.133904px]',
    [TracingProvider.weave]: 'i-custom-public-tracing-weave-icon w-30',
    [TracingProvider.aliyun]: 'i-custom-public-tracing-aliyun-icon w-16.25',
    [TracingProvider.mlflow]: 'i-custom-public-tracing-mlflow-icon w-11',
    [TracingProvider.databricks]: 'i-custom-public-tracing-databricks-icon w-25',
    [TracingProvider.tencent]: 'i-custom-public-tracing-tencent-icon w-20',
  }
  const inUseProviderIconClassName = inUseTracingProvider
    ? providerIconClassMap[inUseTracingProvider]
    : undefined

  const hasConfiguredTracing = [...configs.values()].some((config) => config !== null)
  const handleTracingConfigRemoved = (provider: TracingProvider) => {
    if (provider === inUseTracingProvider) {
      handleTracingStatusChange({ enabled: false, tracing_provider: null }, true)
    }
  }

  const failedConfigs = configQueries.filter((query) => query.isError && !query.data)
  const statusFailed = statusQuery.isError && !tracingStatus
  if (statusFailed || failedConfigs.length > 0) {
    return (
      <Button
        variant="secondary"
        onClick={() => {
          if (statusFailed) void statusQuery.refetch()
          failedConfigs.forEach((query) => {
            void query.refetch()
          })
        }}
      >
        {t(($) => $['tracing.title'], { ns: 'app' })}
        {' · '}
        {t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
      </Button>
    )
  }
  const isLoading = statusQuery.isPending || configQueries.some((query) => query.isPending)

  return (
    <div className={cn('flex items-center justify-between')}>
      {!inUseTracingProvider && (
        <ConfigButton
          key={`unconfigured-${appId}`}
          appId={appId}
          readOnly={readOnly}
          disabled={isLoading}
          hasConfigured={false}
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
          onConfigRemoved={handleTracingConfigRemoved}
        >
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
        </ConfigButton>
      )}
      {hasConfiguredTracing && (
        <ConfigButton
          key={`configured-${appId}`}
          appId={appId}
          readOnly={readOnly}
          disabled={isLoading}
          hasConfigured
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
          onConfigRemoved={handleTracingConfigRemoved}
        >
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
        </ConfigButton>
      )}
    </div>
  )
}
export default React.memo(Panel)
