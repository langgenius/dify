import type { ExternalAgentConnectionResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type { ExternalConnectionComparisonSnapshot } from './edit-connection-snapshot'
import { Alert, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { connectionComparisonChanges, publicConnectionCard } from './edit-connection-snapshot'

export function EditConnectionConflict({
  draft,
  latest,
  latestSavedAudit,
  loading,
  loadFailed,
  onRetry,
}: {
  draft: ExternalConnectionComparisonSnapshot
  latest?: ExternalAgentConnectionResponse
  latestSavedAudit?: string
  loading: boolean
  loadFailed: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const authentication = (value?: string) =>
    value === 'bearer'
      ? t(($) => $['external.connection.bearerToken'])
      : value === 'none'
        ? t(($) => $['external.connection.none'])
        : value
  const fields = [
    {
      label: t(($) => $['external.connection.endpoint']),
      value: draft.endpoint,
    },
    {
      label: t(($) => $['external.connection.authentication']),
      value: authentication(draft.auth_type),
    },
  ]
  const changedFields = latest ? connectionComparisonChanges(draft, latest) : []
  const rows = [
    {
      key: 'endpoint',
      label: t(($) => $['external.connection.endpoint']),
      yours: draft.endpoint,
      latest: latest?.endpoint,
    },
    {
      key: 'auth_type',
      label: t(($) => $['external.connection.authentication']),
      yours: authentication(draft.auth_type),
      latest: authentication(latest?.auth_type),
    },
    {
      key: 'interface_url',
      label: t(($) => $['external.connection.conflict.interfaceUrl']),
      yours: draft.interface_url,
      latest: latest?.interface_url,
    },
    {
      key: 'profile',
      label: t(($) => $['external.connection.conflict.profile']),
      yours: draft.profile,
      latest: latest?.profile,
    },
    {
      key: 'has_credential',
      label: t(($) => $['external.connection.conflict.credentialConfigured']),
      yours: draft.has_credential,
      latest: latest?.has_credential,
    },
    {
      key: 'auth_check',
      label: t(($) => $['external.connection.conflict.authCheck']),
      yours: draft.auth_check,
      latest: latest?.auth_check,
    },
    {
      key: 'card',
      label: t(($) => $['external.connection.conflict.agentCard']),
      yours: draft.card,
      latest: latest && publicConnectionCard(latest.card),
    },
    {
      key: 'capabilities',
      label: t(($) => $['external.connection.conflict.capabilities']),
      yours: draft.capabilities,
      latest: latest?.capabilities,
    },
  ] satisfies {
    key: keyof ExternalConnectionComparisonSnapshot
    label: string
    yours: unknown
    latest: unknown
  }[]
  const formatValue = (value: unknown) =>
    value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <Field key={field.label} disabled className="flex flex-col gap-1.5">
          <FieldLabel>{field.label}</FieldLabel>
          <Input value={field.value} readOnly />
        </Field>
      ))}
      {draft.auth_type === 'bearer' && (
        <Field disabled className="flex flex-col gap-1.5">
          <FieldLabel>{t(($) => $['external.connection.token'])}</FieldLabel>
          <Input type="password" value="" placeholder="••••••••••••" readOnly />
        </Field>
      )}
      <div className="h-px bg-divider-subtle" />
      {latest && !loading && !loadFailed && (
        <p className="system-xs-regular wrap-anywhere text-text-tertiary">{latestSavedAudit}</p>
      )}
      {loading ? (
        <LoadingPlaceholder className="h-20" />
      ) : loadFailed ? (
        <div className="space-y-2">
          <p role="alert" className="system-xs-regular text-text-destructive">
            {t(($) => $['external.connection.conflict.loadFailed'])}
          </p>
          <Button variant="secondary" onClick={onRetry}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      ) : latest ? (
        <div className="overflow-hidden rounded-lg border border-divider-subtle">
          <table className="w-full table-fixed text-start system-xs-regular text-text-secondary">
            <thead className="bg-background-section text-text-tertiary">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-normal">
                  {t(($) => $['external.connection.conflict.property'])}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-normal">
                  {t(($) => $['external.connection.conflict.yourChanges'])}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-normal">
                  {t(($) => $['external.connection.conflict.latestConfiguration'])}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider-subtle">
              {rows
                .filter((row) => changedFields.includes(row.key))
                .map((row) => (
                  <tr key={row.key}>
                    <th
                      scope="row"
                      className="px-3 py-2 text-start align-top font-normal wrap-anywhere text-text-tertiary"
                    >
                      {row.label}
                    </th>
                    <td className="px-3 py-2 align-top wrap-anywhere whitespace-pre-wrap">
                      {formatValue(row.yours)}
                    </td>
                    <td className="px-3 py-2 align-top wrap-anywhere whitespace-pre-wrap">
                      {formatValue(row.latest)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="system-xs-regular text-text-tertiary">
        {t(($) => $['external.connection.conflict.comparisonHint'])}
      </p>
      <p className="system-xs-regular text-text-tertiary">
        {t(($) => $['external.connection.conflict.credentialsHint'])}
      </p>
      <Alert type="warning">
        <AlertTitle>{t(($) => $['external.connection.conflict.title'])}</AlertTitle>
        <AlertDescription>
          {t(($) => $['external.connection.conflict.description'])}
        </AlertDescription>
      </Alert>
    </div>
  )
}
