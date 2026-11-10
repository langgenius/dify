import type {
  JsonValue,
  PendingActionDisclosure,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useDifyBuilderLocale } from '../i18n/use-builder-locale'

const hasDisclosureValue = (value: JsonValue) =>
  value != null && (typeof value === 'object' ? Object.keys(value).length > 0 : value !== '')

function disclosureValue(value: JsonValue, yes: string, no: string): ReactNode {
  if (!hasDisclosureValue(value)) return '—'
  if (typeof value === 'boolean') return value ? yes : no
  if (Array.isArray(value)) {
    const occurrences = new Map<string, number>()
    return (
      <ul className="list-disc ps-4">
        {value.map((entry) => {
          const identity = JSON.stringify(entry)
          const occurrence = (occurrences.get(identity) ?? 0) + 1
          occurrences.set(identity, occurrence)
          return <li key={`${identity}:${occurrence}`}>{disclosureValue(entry, yes, no)}</li>
        })}
      </ul>
    )
  }
  if (typeof value === 'object' && value !== null)
    return (
      <dl className="space-y-1">
        {Object.entries(value).map(([key, entry]) => (
          <div key={key}>
            <dt className="font-medium text-text-secondary">{key}</dt>
            <dd>{disclosureValue(entry, yes, no)}</dd>
          </div>
        ))}
      </dl>
    )
  return String(value)
}

export const NativeApprovalDetails = ({ pending }: { pending: PendingActionDisclosure }) => {
  const locale = useDifyBuilderLocale()
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const yes = t(($) => $['interactionResponse.booleanTrue'])
  const no = t(($) => $['interactionResponse.booleanFalse'])
  const limits = pending.approval_limits

  return (
    <div className="mb-3 space-y-2 system-xs-regular wrap-anywhere text-text-secondary">
      <dl className="space-y-2 whitespace-pre-wrap">
        <div>
          <dt className="system-xs-medium text-text-primary">{t(($) => $['nativeTest.action'])}</dt>
          <dd>{pending.action}</dd>
        </div>
        {pending.account_label && (
          <div>
            <dt className="system-xs-medium text-text-primary">
              {t(($) => $['nativeTest.account'])}
            </dt>
            <dd>{pending.account_label}</dd>
          </div>
        )}
        {hasDisclosureValue(pending.target) && (
          <div>
            <dt className="system-xs-medium text-text-primary">
              {t(($) => $['nativeTest.target'])}
            </dt>
            <dd>{disclosureValue(pending.target, yes, no)}</dd>
          </div>
        )}
        {pending.risk_notice && (
          <div>
            <dt className="system-xs-medium text-text-primary">{t(($) => $['nativeTest.risk'])}</dt>
            <dd>{pending.risk_notice}</dd>
          </div>
        )}
        {limits && (
          <>
            <div>
              <dt className="system-xs-medium text-text-primary">
                {t(($) => $['nativeTest.scope'])}
              </dt>
              <dd>
                {t(($) => $['nativeTest.limits'], {
                  calls: limits.max_calls,
                  dispatches: limits.max_dispatches,
                  cost: limits.max_cost_units,
                })}
              </dd>
            </div>
            <div>
              <dt className="system-xs-medium text-text-primary">
                {t(($) => $['nativeTest.expiresAt'])}
              </dt>
              <dd>
                <time dateTime={limits.expires_at}>
                  {new Date(limits.expires_at).toLocaleString(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
              </dd>
            </div>
          </>
        )}
      </dl>
      {hasDisclosureValue(pending.parameters_summary) && (
        <details>
          <summary className="cursor-pointer rounded-sm system-xs-medium text-text-primary focus-visible:ring-1 focus-visible:ring-state-accent-solid">
            {t(($) => $['nativeTest.parameters'])}
          </summary>
          <div className="mt-1 whitespace-pre-wrap">
            {disclosureValue(pending.parameters_summary, yes, no)}
          </div>
        </details>
      )}
    </div>
  )
}
