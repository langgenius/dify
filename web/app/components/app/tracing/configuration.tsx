'use client'
import type { AppTracePayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ProviderConfigError } from './provider-panel'
import type { ConfigurableTracingProvider } from './providers'
import type { TracingResource } from './resource'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Separator } from '@langgenius/dify-ui/separator'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { noop, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/console'
import { selectAgentTracingEnabled, traceCapabilitiesQueryOptions } from './capabilities'
import { ConfigPopup } from './config-popup'
import { configurableProviders, tracingProviders } from './providers'
import { tracingQueryParamName, tracingQueryParser } from './query-params'
import { usesAgentTracePipeline } from './resource'
import { TracingIcon } from './tracing-icon'

const I18N_PREFIX = 'tracing'

type TracingConfigurationProps = {
  resource: TracingResource
  readOnly: boolean
}

export function TracingConfiguration({ resource, readOnly }: TracingConfigurationProps) {
  const { t } = useTranslation(['app', 'common'])
  const [destination, setDestination] = useQueryState(tracingQueryParamName, tracingQueryParser)
  const statusQuery = useQuery(
    resource.kind === 'agent'
      ? consoleQuery.agent.byAgentId.trace.get.queryOptions({
          input: { params: { agent_id: resource.agentId } },
        })
      : consoleQuery.apps.byAppId.trace.get.queryOptions({
          input: { params: { app_id: resource.appId } },
        }),
  )
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
  const resourceId = resource.kind === 'agent' ? resource.agentId : resource.appId
  const scope = { id: `tracing:${resource.kind}:${resourceId}` }
  const updateAppTrace = useMutation(
    consoleQuery.apps.byAppId.trace.post.mutationOptions({ context: { silent: true }, scope }),
  )
  const updateAgentTrace = useMutation(
    consoleQuery.agent.byAgentId.trace.post.mutationOptions({ context: { silent: true }, scope }),
  )
  const updateTracingStatus = resource.kind === 'agent' ? updateAgentTrace : updateAppTrace
  const isCurrentMutation =
    (resource.kind === 'agent'
      ? updateAgentTrace.variables?.params.agent_id
      : updateAppTrace.variables?.params.app_id) === resourceId
  const pending = isCurrentMutation && updateTracingStatus.isPending
  const tracingStatus = pending ? updateTracingStatus.variables.body : statusQuery.data
  const enabled = tracingStatus?.enabled ?? false
  const inUseTracingProvider =
    providers.find((provider) => provider === tracingStatus?.tracing_provider) ?? null
  const queryClient = useQueryClient()
  // The popup's selected provider card shows these; start the request once the user aims at the trigger.
  const { data: agentTracingEnabled } = useQuery(
    consoleQuery.features.get.queryOptions({ select: selectAgentTracingEnabled }),
  )
  const prefetchCapabilities = () => {
    if (!inUseTracingProvider || !usesAgentTracePipeline(resource) || !agentTracingEnabled) return
    void queryClient
      .query(traceCapabilitiesQueryOptions(resource, inUseTracingProvider))
      .catch(noop)
  }
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
    statusQuery.isPending || configQueries.some((query) => query.isPending && !query.isFetched)

  if (isLoading) {
    return (
      <div role="status" aria-label={t(($) => $['tracing.title'], { ns: 'app' })}>
        <span className="sr-only">{t(($) => $.loading, { ns: 'common' })}</span>
        <SkeletonRectangle aria-hidden="true" className="my-0 h-10 w-56 rounded-xl" />
      </div>
    )
  }

  if (resource.kind === 'app' && readOnly && !hasConfiguredTracing) return null

  return (
    <Popover
      key={resource.kind === 'agent' ? resource.agentId : resource.appId}
      open={destination === 'configure'}
      onOpenChange={(open) => {
        void setDestination(open ? 'configure' : null)
      }}
    >
      <PopoverTrigger
        onPointerEnter={prefetchCapabilities}
        onFocus={prefetchCapabilities}
        render={
          <Button className="h-auto gap-0 rounded-xl bg-background-default-lighter p-2 inset-ring-components-panel-border hover:bg-background-default-dodge" />
        }
      >
        {hasConfiguredTracing ? (
          <span className="flex items-center gap-2">
            {inUseProviderIconClassName && (
              <span aria-hidden className="flex items-center pr-2 pl-1">
                <span className={cn(inUseProviderIconClassName, 'h-5')} />
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="flex size-3 items-center justify-center">
                <StatusDot status={enabled ? 'success' : 'disabled'} />
              </span>
              <span
                className={cn(
                  'system-xs-semibold-uppercase',
                  enabled ? 'text-util-colors-green-green-600' : 'text-text-tertiary',
                )}
              >
                {t(($) => $[`${I18N_PREFIX}.${enabled ? 'enabled' : 'disabled'}`], { ns: 'app' })}
              </span>
            </span>
            <Separator decorative orientation="vertical" className="ml-1 h-3.5" />
            <span aria-hidden className="flex size-6 items-center justify-center rounded-md">
              <span className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            </span>
          </span>
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
      </PopoverTrigger>
      <PopoverContent
        placement="bottom-end"
        sideOffset={12}
        className="border-none bg-transparent shadow-none"
      >
        <ConfigPopup
          resource={resource}
          readOnly={readOnly}
          pending={pending}
          policyError={isCurrentMutation ? updateTracingStatus.error?.message : undefined}
          policy={tracingStatus}
          onPolicyChange={updatePolicy}
          configs={Object.fromEntries(configs)}
          configErrors={configErrors}
        />
      </PopoverContent>
    </Popover>
  )
}
