import type { ApiKeyItem } from '@dify/contracts/api/console/apps/types.gen'
import type { EnvironmentApiKey } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import { AlertDialogTrigger } from '@langgenius/dify-ui/alert-dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'

type ApiKeyTableProps = {
  apiKeys: Array<ApiKeyItem | EnvironmentApiKey>
  canManage: boolean
  deleteDialogHandle: AlertDialogHandle<string>
  // Dataset keys carry a knowledge-base scope; enable the SCOPE column to surface it.
  showScope?: boolean
}

export function ApiKeyTable({
  apiKeys,
  canManage,
  showScope = false,
  deleteDialogHandle,
}: ApiKeyTableProps) {
  const { t } = useTranslation(['appApi', 'common', 'time'])
  const { formatTime } = useTimestamp()
  const maskToken = (token: string) => `${token.slice(0, 3)}...${token.slice(-20)}`

  // Only dataset keys expose dataset_ids; an empty/absent list means the key can access
  // every knowledge base in the workspace.
  const scopeLabel = (apiKey: ApiKeyItem | EnvironmentApiKey) => {
    const datasetIds = (apiKey as { dataset_ids?: string[] }).dataset_ids
    if (!datasetIds?.length) return t(($) => $['apiKeyModal.scopeAllDatasets'], { ns: 'appApi' })
    return t(($) => $['apiKeyModal.scopeCount'], { ns: 'appApi', count: datasetIds.length })
  }

  return (
    <div className="min-h-0 overflow-auto border-y border-divider-subtle">
      <table className="w-full table-fixed text-left system-sm-regular text-text-secondary">
        <thead className="sticky top-0 bg-components-panel-bg system-xs-semibold-uppercase text-text-tertiary">
          <tr className="border-b border-divider-regular">
            <th className="w-64 px-6 py-2" scope="col">
              {t(($) => $['apiKeyModal.secretKey'], { ns: 'appApi' })}
            </th>
            {showScope && (
              <th className="w-40 px-3 py-2" scope="col">
                {t(($) => $['apiKeyModal.scope'], { ns: 'appApi' })}
              </th>
            )}
            <th className="w-48 px-3 py-2" scope="col">
              {t(($) => $['apiKeyModal.created'], { ns: 'appApi' })}
            </th>
            <th className="w-48 px-3 py-2" scope="col">
              {t(($) => $['apiKeyModal.lastUsed'], { ns: 'appApi' })}
            </th>
            <th className="w-24 px-6 py-2" scope="col">
              <span className="sr-only">{t(($) => $['operation.settings'], { ns: 'common' })}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {apiKeys.map((apiKey) => (
            <tr className="border-b border-divider-regular last:border-b-0" key={apiKey.id}>
              <td className="truncate px-6 py-2 font-mono">{maskToken(apiKey.token)}</td>
              {showScope && <td className="truncate px-3 py-2">{scopeLabel(apiKey)}</td>}
              <td className="truncate px-3 py-2">
                {formatTime(
                  Number(apiKey.created_at),
                  t(($) => $['dateFormats.withSeconds'], { ns: 'time' }) as string,
                )}
              </td>
              <td className="truncate px-3 py-2">
                {apiKey.last_used_at
                  ? formatTime(
                      Number(apiKey.last_used_at),
                      t(($) => $['dateFormats.withSeconds'], { ns: 'time' }) as string,
                    )
                  : t(($) => $.never, { ns: 'appApi' })}
              </td>
              <td className="px-6 py-1">
                <div className="flex justify-end gap-1">
                  {canManage && (
                    <AlertDialogTrigger
                      handle={deleteDialogHandle}
                      id={apiKey.id}
                      payload={apiKey.id}
                      render={
                        <IconButton
                          aria-label={`${t(($) => $['operation.delete'], { ns: 'common' })} ${maskToken(apiKey.token)}`}
                        >
                          <span aria-hidden className="i-ri-delete-bin-line size-4" />
                        </IconButton>
                      }
                    />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
