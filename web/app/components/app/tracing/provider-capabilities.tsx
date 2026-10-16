import type { TraceProviderSupportResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ConfigurableTracingProvider } from './providers'
import type { TracingResource } from './resource'
import { Button } from '@langgenius/dify-ui/button'
import { Collapsible, CollapsiblePanel } from '@langgenius/dify-ui/collapsible'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { traceCapabilitiesQueryOptions } from './capabilities'
import { SummaryDisclosureTrigger } from './summary-disclosure'

type SupportFlag = {
  [K in keyof TraceProviderSupportResponse]: TraceProviderSupportResponse[K] extends boolean
    ? K
    : never
}[keyof TraceProviderSupportResponse]

// Display order; `satisfies` fails the build when the contract adds or drops a support flag.
const displayOrder = {
  agent_spans: true,
  session: true,
  native_usage: true,
  native_cost: true,
  trace_url: true,
  span_url: true,
} satisfies Record<SupportFlag, true>
const capabilityKeys = Object.keys(displayOrder) as SupportFlag[]

/** What the selected provider supports for Agent traces, disclosed on demand. */
export function ProviderCapabilities({
  resource,
  provider,
}: {
  resource: TracingResource
  provider: ConfigurableTracingProvider
}) {
  const { t } = useTranslation(['app', 'common'])
  const capabilities = useQuery(traceCapabilitiesQueryOptions(resource, provider))

  if (!capabilities.data) {
    // Holds the summary row's height so the card does not shift when support arrives.
    if (!capabilities.isError)
      return (
        <div aria-hidden className="mt-2 flex h-5 items-center">
          <SkeletonRectangle className="my-0 h-2.5 w-24" />
        </div>
      )
    return (
      <div role="alert" className="mt-2 flex items-center gap-2">
        <span className="system-xs-regular text-text-destructive">
          {t(($) => $['tracing.capabilitiesLoadFailed'], { ns: 'app' })}
        </span>
        <Button
          size="small"
          loading={capabilities.isFetching}
          onClick={() => {
            void capabilities.refetch()
          }}
        >
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      </div>
    )
  }

  const support = capabilities.data
  // Provider support describes Agent tracing, which this deployment does not run.
  if (!support.api_collection_enabled) return null
  const unsupportedCount = capabilityKeys.filter((key) => !support[key]).length

  return (
    <div className="mt-2 space-y-1">
      {!support.agent_spans && (
        <p className="flex gap-1 system-xs-regular text-text-warning">
          <span aria-hidden className="mt-px i-ri-error-warning-line size-3.5 shrink-0" />
          {t(($) => $['tracing.agentSpansUnsupported'], {
            ns: 'app',
            provider: t(($) => $[`tracing.${provider}.title`], { ns: 'app' }),
          })}
        </p>
      )}
      <Collapsible>
        <SummaryDisclosureTrigger
          label={t(($) => $['tracing.capabilities'], { ns: 'app' })}
          summary={
            unsupportedCount
              ? t(($) => $['tracing.capabilitySummary.unsupported'], {
                  ns: 'app',
                  count: unsupportedCount,
                })
              : t(($) => $['tracing.capabilitySummary.allSupported'], { ns: 'app' })
          }
        />
        <CollapsiblePanel>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1.5 pb-0.5 system-xs-regular">
            {capabilityKeys.map((key) => (
              <div key={key} className="flex justify-between gap-2">
                <dt className="text-text-tertiary">
                  {t(($) => $[`tracing.capability.${key}`], { ns: 'app' })}
                </dt>
                <dd
                  data-supported={support[key] || undefined}
                  className="text-text-tertiary data-supported:text-text-secondary"
                >
                  {t(($) => $[support[key] ? 'tracing.supported' : 'tracing.unsupported'], {
                    ns: 'app',
                  })}
                </dd>
              </div>
            ))}
          </dl>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  )
}
