'use client'
import type { AppTracePayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ProviderConfigError } from './provider-panel'
import type { ConfigurableTracingProvider } from './providers'
import type { TracingResource } from './resource'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Separator } from '@langgenius/dify-ui/separator'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import ConfigButton from './config-button'
import { configurableProviders, tracingProviders } from './providers'
import TracingIcon from './tracing-icon'

const I18N_PREFIX = 'tracing'

type TracingConfigurationProps = {
  resource: TracingResource
  readOnly: boolean
}

export function TracingConfiguration({ resource, readOnly }: TracingConfigurationProps) {
  const { t } = useTranslation(['app', 'common'])
  const statusQuery = useQuery(
    resource.kind === 'agent'
      ? consoleQuery.agent.byAgentId.trace.get.queryOptions({
          input: { params: { agent_id: resource.agentId } },
        })
      : consoleQuery.apps.byAppId.trace.get.queryOptions({
          input: { params: { app_id: resource.appId } },
        }),
  )
  const tracingStatus = statusQuery.data
  const providers = configurableProviders
  const configQueries = useQueries({
    queries: readOnly
      ? []
      : providers.map((provider) =>
          resource.kind === 'agent'
            ? consoleQuery.agent.byAgentId.traceConfig.get.queryOptions({
                input: {
                  params: { agent_id: resource.agentId },
                  query: { tracing_provider: provider },
                },
              })
            : consoleQuery.apps.byAppId.traceConfig.get.queryOptions({
                input: {
                  params: { app_id: resource.appId },
                  query: { tracing_provider: provider },
                },
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
  const updateAppTrace = useMutation(
    consoleQuery.apps.byAppId.trace.post.mutationOptions({ context: { silent: true } }),
  )
  const updateAgentTrace = useMutation(
    consoleQuery.agent.byAgentId.trace.post.mutationOptions({ context: { silent: true } }),
  )
  const updateTracingStatus = resource.kind === 'agent' ? updateAgentTrace : updateAppTrace
  const enabled = tracingStatus?.enabled ?? false
  const inUseTracingProvider =
    providers.find((provider) => provider === tracingStatus?.tracing_provider) ?? null
  const updatePolicy = async (changes: Partial<AppTracePayload>) => {
    if (!tracingStatus || readOnly) return
    const body: AppTracePayload = {
      enabled,
      tracing_provider: tracingStatus.tracing_provider ?? null,
      capture_content: tracingStatus.capture_content ?? false,
      capture_agent: tracingStatus.capture_agent ?? true,
      ...changes,
    }
    if (resource.kind === 'agent')
      await updateAgentTrace.mutateAsync({ params: { agent_id: resource.agentId }, body })
    else await updateAppTrace.mutateAsync({ params: { app_id: resource.appId }, body })
  }
  const handleTracingEnabledChange = (enabled: boolean) => {
    void updatePolicy({ enabled }).catch(() => {})
  }
  const handleChooseProvider = (provider: ConfigurableTracingProvider) =>
    updatePolicy({ tracing_provider: provider, enabled: true })
  const handleBeforeRemove = async (provider: ConfigurableTracingProvider) => {
    if (provider === inUseTracingProvider)
      await updatePolicy({ enabled: false, tracing_provider: null })
  }
  const inUseProviderIconClassName = inUseTracingProvider
    ? tracingProviders[inUseTracingProvider].icon
    : undefined

  const hasConfiguredTracing =
    !!inUseTracingProvider || [...configs.values()].some((config) => config !== null)
  const configErrors: Partial<Record<ConfigurableTracingProvider, ProviderConfigError>> = {}
  configQueries.forEach((query, index) => {
    const provider = providers[index]
    if (!readOnly && provider && query.isFetched && !query.data) {
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
    statusQuery.isPending ||
    (!readOnly && configQueries.some((query) => query.isPending && !query.isFetched))

  return (
    <div className={cn('flex items-center justify-between')}>
      <ConfigButton
        key={resource.kind === 'agent' ? resource.agentId : resource.appId}
        resource={resource}
        readOnly={readOnly}
        disabled={isLoading}
        hasConfigured={(resource.kind === 'agent' && readOnly) || hasConfiguredTracing}
        enabled={enabled}
        onStatusChange={handleTracingEnabledChange}
        chosenProvider={inUseTracingProvider}
        onChooseProvider={handleChooseProvider}
        pending={updateTracingStatus.isPending}
        policyError={updateTracingStatus.error?.message}
        policy={tracingStatus}
        onPolicyChange={updatePolicy}
        configs={Object.fromEntries(configs)}
        configErrors={configErrors}
        onBeforeRemove={handleBeforeRemove}
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
