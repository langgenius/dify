import type { TracingResource } from './resource'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { getAppACLCapabilities } from '@/utils/permission'
import { traceCapabilitiesQueryOptions } from './capabilities'
import { hasProviderForm } from './providers'
import { tracingQueryParamName } from './query-params'

function useAppTracingAccess(appId: string) {
  const { data: appDetail } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
  )
  const { data: currentUserId } = useQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  if (!appDetail) return { canMonitor: false, canConfigureTracing: false }
  return getAppACLCapabilities(appDetail.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail.maintainer,
    workspacePermissionKeys,
  })
}

/** Read-only summary for Agents that run under the tracing settings of the calling Workflow. */
export function InheritedTracingSummary({
  resource,
}: {
  resource: Extract<TracingResource, { kind: 'app' }>
}) {
  const { appId } = resource
  const { t } = useTranslation(['app', 'common'])
  const titleId = useId()
  const settingsHintId = useId()
  const { canMonitor, canConfigureTracing } = useAppTracingAccess(appId)
  // Settings are edited on the monitoring page in another tab, so refresh when the editor regains focus.
  const statusQuery = useQuery(
    consoleQuery.apps.byAppId.trace.get.queryOptions({
      input: { params: { app_id: appId } },
      refetchOnWindowFocus: 'always',
    }),
  )
  const policy = statusQuery.data
  const provider = hasProviderForm(policy?.tracing_provider) ? policy.tracing_provider : null
  const enabled = !!policy?.enabled && !!provider
  const { data: agentTracingEnabled } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.agent_tracing_api_collection_enabled,
    }),
  )
  const capabilitiesQuery = useQuery(
    traceCapabilitiesQueryOptions(
      resource,
      enabled && canMonitor && agentTracingEnabled ? provider : null,
    ),
  )
  const capabilities = capabilitiesQuery.data
  const providerName = provider ? t(($) => $[`tracing.${provider}.title`], { ns: 'app' }) : ''
  const onOff = (value: boolean) =>
    t(($) => $[value ? 'tracing.inherited.on' : 'tracing.inherited.off'], { ns: 'app' })

  const status = provider ? (
    <>
      <StatusDot size="small" status={enabled ? 'success' : 'disabled'} />
      <span data-enabled={enabled || undefined} className="data-enabled:text-text-secondary">
        {t(
          ($) =>
            $[enabled ? 'tracing.inherited.providerEnabled' : 'tracing.inherited.providerDisabled'],
          { ns: 'app', provider: providerName },
        )}
      </span>
    </>
  ) : (
    t(($) => $['tracing.inherited.notConfigured'], { ns: 'app' })
  )

  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-1 px-4 py-2">
      <div className="flex min-h-6 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <span id={titleId} className="system-sm-semibold-uppercase text-text-secondary">
            {t(($) => $['tracing.inherited.title'], { ns: 'app' })}
          </span>
          <Infotip>
            <InfotipTrigger aria-labelledby={titleId} />
            <InfotipContent className="max-w-72">
              <p>{t(($) => $['tracing.inherited.description'], { ns: 'app' })}</p>
              {/* The capture policy has no effect where Agent tracing is unavailable. */}
              {enabled && agentTracingEnabled !== false && (
                <dl className="mt-2 space-y-0.5">
                  <div className="flex justify-between gap-3">
                    <dt>{t(($) => $['tracing.captureContent'], { ns: 'app' })}</dt>
                    <dd>{onOff(policy.capture_content ?? false)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>{t(($) => $['tracing.captureAgent'], { ns: 'app' })}</dt>
                    <dd>{onOff(policy.capture_agent ?? true)}</dd>
                  </div>
                </dl>
              )}
            </InfotipContent>
          </Infotip>
        </div>
        {!policy && statusQuery.isError ? (
          <>
            <span className="system-xs-regular text-text-destructive">
              {t(($) => $['tracing.inherited.loadFailed'], { ns: 'app' })}
            </span>
            <Button
              variant="secondary"
              size="small"
              loading={statusQuery.isFetching}
              onClick={() => {
                void statusQuery.refetch()
              }}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </>
        ) : !policy ? (
          <span aria-hidden className="h-2.5 w-24 rounded-xs bg-text-quaternary/20" />
        ) : canMonitor && canConfigureTracing ? (
          <Link
            href={`/app/${appId}/overview?${tracingQueryParamName}=configure`}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={settingsHintId}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'small' }),
              'shrink-0 gap-1.5 text-text-tertiary hover:text-text-secondary',
            )}
          >
            {status}
            <span aria-hidden className="i-ri-external-link-line size-3.5 shrink-0" />
            <span id={settingsHintId} hidden>
              {`${t(($) => $['tracing.inherited.settings'], { ns: 'app' })} (${t(($) => $['operation.openInNewTab'], { ns: 'common' })})`}
            </span>
          </Link>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 system-xs-medium text-text-tertiary">
            {status}
          </span>
        )}
      </div>
      {enabled && agentTracingEnabled === false ? (
        <p className="flex gap-1 system-xs-regular text-text-warning">
          <span aria-hidden className="mt-px i-ri-error-warning-line size-3.5 shrink-0" />
          {t(($) => $['tracing.agentTracingUnavailable'], { ns: 'app' })}
        </p>
      ) : capabilities && !capabilities.agent_spans ? (
        <p className="flex gap-1 system-xs-regular text-text-warning">
          <span aria-hidden className="mt-px i-ri-error-warning-line size-3.5 shrink-0" />
          {t(($) => $['tracing.agentSpansUnsupported'], {
            ns: 'app',
            provider: providerName,
          })}
        </p>
      ) : null}
    </div>
  )
}
