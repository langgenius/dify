'use client'

import type { AppTracePayload } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import type {
  AliyunConfig,
  ArizeConfig,
  DatabricksConfig,
  LangFuseConfig,
  LangSmithConfig,
  MLflowConfig,
  OpikConfig,
  PhoenixConfig,
  TencentConfig,
  WeaveConfig,
} from './type'
import { cn } from '@langgenius/dify-ui/cn'
import { Separator } from '@langgenius/dify-ui/separator'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
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
  const { data: tracingStatus } = useQuery(
    consoleQuery.apps.byAppId.trace.get.queryOptions({
      input: { params: { app_id: appId } },
    }),
  )
  const providers = Object.values(TracingProvider)
  const configQueries = useQueries({
    queries: providers.map((provider) =>
      consoleQuery.apps.byAppId.traceConfig.get.queryOptions({
        input: { params: { app_id: appId }, query: { tracing_provider: provider } },
      }),
    ),
  })
  const configs = Object.fromEntries(
    providers.map((provider, index) => {
      const response = configQueries[index]?.data
      return [provider, response?.has_not_configured ? null : (response?.tracing_config ?? null)]
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

  const arizeConfig = configs[TracingProvider.arize] as ArizeConfig | null
  const phoenixConfig = configs[TracingProvider.phoenix] as PhoenixConfig | null
  const langSmithConfig = configs[TracingProvider.langSmith] as LangSmithConfig | null
  const langFuseConfig = configs[TracingProvider.langfuse] as LangFuseConfig | null
  const opikConfig = configs[TracingProvider.opik] as OpikConfig | null
  const weaveConfig = configs[TracingProvider.weave] as WeaveConfig | null
  const aliyunConfig = configs[TracingProvider.aliyun] as AliyunConfig | null
  const mlflowConfig = configs[TracingProvider.mlflow] as MLflowConfig | null
  const databricksConfig = configs[TracingProvider.databricks] as DatabricksConfig | null
  const tencentConfig = configs[TracingProvider.tencent] as TencentConfig | null
  const hasConfiguredTracing = Object.values(configs).some(Boolean)
  const handleTracingConfigRemoved = (provider: TracingProvider) => {
    if (provider === inUseTracingProvider) {
      handleTracingStatusChange({ enabled: false, tracing_provider: null }, true)
    }
  }

  if (!tracingStatus || configQueries.some((query) => query.isPending)) {
    return (
      <div className="mb-3 flex items-center justify-between">
        <div className="w-50">
          <LoadingPlaceholder />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center justify-between')}>
      {!inUseTracingProvider && (
        <ConfigButton
          key={`unconfigured-${appId}`}
          appId={appId}
          readOnly={readOnly}
          hasConfigured={false}
          enabled={enabled}
          onStatusChange={handleTracingEnabledChange}
          chosenProvider={inUseTracingProvider}
          onChooseProvider={handleChooseProvider}
          arizeConfig={arizeConfig}
          phoenixConfig={phoenixConfig}
          langSmithConfig={langSmithConfig}
          langFuseConfig={langFuseConfig}
          opikConfig={opikConfig}
          weaveConfig={weaveConfig}
          aliyunConfig={aliyunConfig}
          mlflowConfig={mlflowConfig}
          databricksConfig={databricksConfig}
          tencentConfig={tencentConfig}
          onConfigRemoved={handleTracingConfigRemoved}
        >
          <div
            className={cn(
              'flex cursor-pointer items-center rounded-xl border-[0.5px] border-components-panel-border bg-background-default-dodge p-2 shadow-xs select-none hover:bg-background-default-lighter',
            )}
          >
            <TracingIcon size="md" />
            <div className="mx-2 system-sm-semibold text-text-secondary">
              {t(($) => $[`${I18N_PREFIX}.title`], { ns: 'app' })}
            </div>
            <div className="rounded-md p-1">
              <span className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            </div>
            <Separator decorative orientation="vertical" className="mx-2 h-3.5" />
            <div className="rounded-md p-1">
              <span className="i-ri-arrow-down-double-line size-4 text-text-tertiary" />
            </div>
          </div>
        </ConfigButton>
      )}
      {hasConfiguredTracing && (
        <ConfigButton
          key={`configured-${appId}`}
          appId={appId}
          readOnly={readOnly}
          hasConfigured
          enabled={enabled}
          onStatusChange={handleTracingEnabledChange}
          chosenProvider={inUseTracingProvider}
          onChooseProvider={handleChooseProvider}
          arizeConfig={arizeConfig}
          phoenixConfig={phoenixConfig}
          langSmithConfig={langSmithConfig}
          langFuseConfig={langFuseConfig}
          opikConfig={opikConfig}
          weaveConfig={weaveConfig}
          aliyunConfig={aliyunConfig}
          mlflowConfig={mlflowConfig}
          databricksConfig={databricksConfig}
          tencentConfig={tencentConfig}
          onConfigRemoved={handleTracingConfigRemoved}
        >
          <div
            className={cn(
              'flex cursor-pointer items-center rounded-xl border-[0.5px] border-components-panel-border bg-background-default-dodge p-2 shadow-xs select-none hover:bg-background-default-lighter',
            )}
          >
            <div className="mr-1 ml-4 flex items-center">
              <StatusDot status={enabled ? 'success' : 'disabled'} />
              <div className="ml-1.5 system-xs-semibold-uppercase text-text-tertiary">
                {t(($) => $[`${I18N_PREFIX}.${enabled ? 'enabled' : 'disabled'}`], { ns: 'app' })}
              </div>
            </div>
            {inUseProviderIconClassName && (
              <span aria-hidden className={cn(inUseProviderIconClassName, 'ml-1 h-4')} />
            )}
            <div className="ml-2 rounded-md p-1">
              <span className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            </div>
            <Separator decorative orientation="vertical" className="mx-2 h-3.5" />
          </div>
        </ConfigButton>
      )}
    </div>
  )
}
export default React.memo(Panel)
