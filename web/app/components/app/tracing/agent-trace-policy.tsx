import type { AppTracePayload, AppTraceResponse } from '@dify/contracts/api/console/agent/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldDescription, FieldLabel } from '@langgenius/dify-ui/field'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Switch } from '@langgenius/dify-ui/switch'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'

export function AgentTracePolicy({
  agentId,
  policy,
  readOnly,
  pending,
  onChange,
}: {
  agentId: string
  policy?: AppTraceResponse
  readOnly: boolean
  pending: boolean
  onChange: (changes: Partial<AppTracePayload>) => Promise<void>
}) {
  const { t } = useTranslation(['app', 'common'])
  const contentLabelId = useId()
  const agentLabelId = useId()
  const capabilities = useQuery(
    consoleQuery.agent.byAgentId.traceCapabilities.get.queryOptions({
      input: policy?.tracing_provider
        ? { params: { agent_id: agentId }, query: { tracing_provider: policy.tracing_provider } }
        : skipToken,
    }),
  )
  return (
    <div className="mt-4 space-y-3">
      <Field className="flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <FieldLabel id={contentLabelId}>
            {t(($) => $['tracing.captureContent'], { ns: 'app' })}
          </FieldLabel>
          <Infotip>
            <InfotipTrigger aria-labelledby={contentLabelId} />
            <InfotipContent aria-labelledby={contentLabelId} className="max-w-72">
              {t(($) => $['tracing.captureContentDescription'], { ns: 'app' })}
            </InfotipContent>
          </Infotip>
        </div>
        <Switch
          readOnly={readOnly}
          loading={pending}
          checked={policy?.capture_content ?? false}
          onCheckedChange={(capture_content) => {
            void onChange({ capture_content }).catch(() => {})
          }}
        />
        <FieldDescription className="sr-only">
          {t(($) => $['tracing.captureContentDescription'], { ns: 'app' })}
        </FieldDescription>
      </Field>
      <Field className="flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <FieldLabel id={agentLabelId}>
            {t(($) => $['tracing.captureAgent'], { ns: 'app' })}
          </FieldLabel>
          <Infotip>
            <InfotipTrigger aria-labelledby={agentLabelId} />
            <InfotipContent aria-labelledby={agentLabelId} className="max-w-72">
              {t(($) => $['tracing.captureAgentDescription'], { ns: 'app' })}
            </InfotipContent>
          </Infotip>
        </div>
        <Switch
          readOnly={readOnly}
          loading={pending}
          checked={policy?.capture_agent ?? true}
          onCheckedChange={(capture_agent) => {
            void onChange({ capture_agent }).catch(() => {})
          }}
        />
        <FieldDescription className="sr-only">
          {t(($) => $['tracing.captureAgentDescription'], { ns: 'app' })}
        </FieldDescription>
      </Field>
      {policy?.tracing_provider && capabilities.isPending && (
        <p role="status">{t(($) => $.loading, { ns: 'common' })}</p>
      )}
      {capabilities.isError && (
        <div role="alert" className="system-xs-regular text-text-destructive">
          {capabilities.error.message}
          <Button
            disabled={capabilities.isFetching}
            onClick={() => {
              void capabilities.refetch()
            }}
          >
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      {capabilities.data && (
        <>
          <h4 className="system-xs-semibold text-text-secondary">
            {t(($) => $['tracing.capabilities'], { ns: 'app' })}
          </h4>
          <dl className="grid grid-cols-2 gap-2 system-xs-regular">
            {(
              [
                'agent_spans',
                'session',
                'native_usage',
                'native_cost',
                'trace_url',
                'span_url',
              ] as const
            ).map((capability) => (
              <div key={capability} className="flex justify-between gap-2">
                <dt>{t(($) => $[`tracing.capability.${capability}`], { ns: 'app' })}</dt>
                <dd>
                  {t(
                    ($) =>
                      $[
                        capabilities.data[capability] ? 'tracing.supported' : 'tracing.unsupported'
                      ],
                    { ns: 'app' },
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p role="status" className="system-xs-regular text-text-tertiary">
            {t(
              ($) =>
                $[
                  capabilities.data.api_collection_enabled
                    ? 'tracing.runtimeUnverified'
                    : 'tracing.apiCollectionDisabled'
                ],
              { ns: 'app' },
            )}
          </p>
        </>
      )}
    </div>
  )
}
