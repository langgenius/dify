import type { ExternalConnectionSettings } from '../../roster/components/external-connection-verification'
import type { ExternalAgentOverview } from '../model'
import { Alert, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'

export function EditConnectionConflict({
  settings,
  latest,
  latestSavedAudit,
  loading,
  loadFailed,
  onRetry,
}: {
  settings: ExternalConnectionSettings
  latest?: ExternalAgentOverview
  latestSavedAudit?: string
  loading: boolean
  loadFailed: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const authentication = (value: ExternalConnectionSettings['authentication']) =>
    value === 'bearer'
      ? t(($) => $['external.connection.bearerToken'])
      : t(($) => $['external.connection.none'])
  const rows = [
    {
      label: t(($) => $['external.connection.endpoint']),
      yours: settings.endpoint,
      latest: latest?.endpoint,
    },
    {
      label: t(($) => $['external.connection.authentication']),
      yours: authentication(settings.authentication),
      latest: latest && authentication(latest.authentication),
    },
  ]
  const changes = rows.filter((row) => row.yours !== row.latest)
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <Field key={row.label} disabled className="flex flex-col gap-1.5">
          <FieldLabel>{row.label}</FieldLabel>
          <Input value={row.yours} readOnly />
        </Field>
      ))}
      {settings.authentication === 'bearer' && (
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
      ) : changes.length ? (
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
              {changes.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-3 py-2 text-start font-normal text-text-tertiary">
                    {row.label}
                  </th>
                  <td className="px-3 py-2 wrap-anywhere">{row.yours}</td>
                  <td className="px-3 py-2 wrap-anywhere">{row.latest ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
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
