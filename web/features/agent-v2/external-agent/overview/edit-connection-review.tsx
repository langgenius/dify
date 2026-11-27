import type { ExternalAgentVerificationResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { useTranslation } from 'react-i18next'
import { EditConnectionApps } from './edit-connection-apps'

export function EditConnectionReview({
  agentId,
  review,
  verified,
}: {
  agentId: string
  review: ExternalAgentVerificationResponse
  verified: boolean
}) {
  const { t } = useTranslation(['agentRoster'])
  const labels: Record<string, string> = {
    input_modes_narrowed: t(($) => $['external.connection.warnings.inputModesNarrowed']),
    output_modes_narrowed: t(($) => $['external.connection.warnings.outputModesNarrowed']),
    streaming_removed: t(($) => $['external.connection.warnings.streamingRemoved']),
    auth_requirements_changed: t(($) => $['external.connection.warnings.authenticationChanged']),
    traceability_removed: t(($) => $['external.connection.warnings.traceabilityRemoved']),
    agent_info_changed: t(($) => $['external.connection.warnings.agentInfoChanged']),
    skills_changed: t(($) => $['external.connection.warnings.skillsChanged']),
  }
  const { technical, business } = review.warnings
  return (
    <section className="space-y-2.5 border-t border-divider-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="system-md-semibold text-text-primary">
          {t(($) => $['external.connection.changes'])}
        </h3>
        {verified && (
          <p role="status" className="flex items-center gap-1 system-xs-medium text-text-success">
            <span aria-hidden className="i-ri-checkbox-circle-fill size-3.5 shrink-0" />
            {t(($) => $['external.connection.verified'])}
          </p>
        )}
      </div>
      <div className="rounded-lg bg-background-section p-3">
        <EditConnectionApps agentId={agentId} />
        {technical.length > 0 && (
          <ul className="space-y-3 not-first:mt-3 not-first:border-t not-first:border-divider-subtle not-first:pt-3">
            {technical.map((warning) => (
              <li key={warning} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="i-ri-error-warning-line size-4 shrink-0 text-text-warning-secondary"
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="system-sm-medium text-text-primary">{labels[warning] ?? warning}</p>
                  {warning === 'streaming_removed' && (
                    <p className="system-xs-regular text-text-secondary">
                      {t(($) => $['external.connection.warnings.streamingRemovedDescription'])}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {business.length > 0 && (
          <ul className="space-y-2 ps-6 system-xs-regular text-text-secondary not-first:mt-3 not-first:border-t not-first:border-divider-subtle not-first:pt-3">
            {business.map((warning) => (
              <li key={warning}>{labels[warning] ?? warning}</li>
            ))}
          </ul>
        )}
        {technical.length === 0 && business.length === 0 && (
          <p className="system-xs-regular text-text-tertiary not-first:mt-3 not-first:border-t not-first:border-divider-subtle not-first:pt-3">
            {t(($) => $['external.connection.noWarnings'])}
          </p>
        )}
      </div>
    </section>
  )
}
