import { Button } from '@langgenius/dify-ui/button'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { hasProviderForm } from '@/app/components/app/tracing/providers'
import { consoleQuery } from '@/service/console'
import { MetaDataRow } from './meta'

export type ExternalAgentCaptureSource = { appId: string; invocationId: string }
const pendingDeliveries = new Set(['pending', 'exporting', 'retrying'])

/** Reports the invocation's frozen decisions and prepared payload, never today's settings. */
export function ExternalAgentCaptureRow({ source }: { source: ExternalAgentCaptureSource }) {
  const { t } = useTranslation(['app', 'common'])
  const capture = useQuery(
    consoleQuery.apps.byAppId.externalAgentInvocations.byInvocationId.traceCapture.get.queryOptions(
      {
        input: { params: { app_id: source.appId, invocation_id: source.invocationId } },
        context: { silent: true },
        retry: false,
        refetchOnWindowFocus: false,
        refetchInterval: (query) => {
          const result = query.state.data
          // Stop after twenty successful reads; a slow exporter remains pending with manual refresh.
          return !query.state.error &&
            query.state.dataUpdateCount < 20 &&
            result &&
            (!result.targets_frozen ||
              result.targets.some(
                (target) =>
                  target.status === 'pending' ||
                  (target.delivery_state !== null && pendingDeliveries.has(target.delivery_state)),
              ))
            ? 5000
            : false
        },
      },
    ),
  )

  return (
    <MetaDataRow label={t(($) => $['tracing.captureRun.title'])}>
      <div className="space-y-2">
        {capture.isError ? (
          <p role="alert" className="text-text-destructive">
            {t(($) => $['tracing.captureRun.loadFailed'])}
          </p>
        ) : capture.isPending ? (
          <p role="status">{t(($) => $.loading, { ns: 'common' })}</p>
        ) : capture.data.targets.length === 0 ? (
          <p>
            {t(
              ($) =>
                $[
                  capture.data.targets_frozen
                    ? 'tracing.captureRun.notConfigured'
                    : 'tracing.captureRun.pending'
                ],
            )}
          </p>
        ) : (
          <ul className="space-y-2">
            {capture.data.targets.map((target) => {
              const providerId = target.provider
              const provider = hasProviderForm(providerId)
                ? t(($) => $[`tracing.${providerId}.title`])
                : providerId
              const deliveryStatus =
                target.delivery_state === 'accepted'
                  ? 'accepted'
                  : target.delivery_state === 'failed' || target.delivery_state === 'stopped'
                    ? 'failed'
                    : target.delivery_state === 'uncertain'
                      ? 'uncertain'
                      : target.delivery_state !== null &&
                          pendingDeliveries.has(target.delivery_state)
                        ? 'pending'
                        : null
              const deliveryLabel = deliveryStatus
                ? t(($) => $[`tracing.run.${deliveryStatus}`], { provider })
                : t(($) => $['tracing.captureRun.deliveryUnknown'])
              return (
                <li
                  key={`${target.target_kind}:${target.target_id}:${target.provider}`}
                  className="space-y-1"
                >
                  <p className="system-xs-medium">{provider}</p>
                  <p className="flex items-center gap-1.5">
                    <StatusDot
                      size="small"
                      status={
                        target.status === 'content_included'
                          ? 'success'
                          : target.status === 'pending'
                            ? 'normal'
                            : 'warning'
                      }
                    />
                    {t(($) => $[`tracing.captureRun.${target.status}`])}
                  </p>
                  {target.reasons.length > 0 && (
                    <ul className="space-y-1 text-text-tertiary">
                      {target.reasons.map((reason) => (
                        <li key={reason}>{t(($) => $[`tracing.captureRun.reason.${reason}`])}</li>
                      ))}
                    </ul>
                  )}
                  {target.delivery_state !== null && (
                    <p className="text-text-tertiary">
                      {t(($) => $['tracing.captureRun.delivery'], { state: deliveryLabel })}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <Button
          variant="ghost"
          size="small"
          loading={capture.isFetching}
          onClick={() => {
            void capture.refetch()
          }}
        >
          {t(($) => $['tracing.captureRun.refresh'])}
        </Button>
      </div>
    </MetaDataRow>
  )
}
