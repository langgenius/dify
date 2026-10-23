import type { ApiKeyItem } from '@dify/contracts/api/console/apps/types.gen'
import type { EnvironmentApiKey } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { AlertDialogTrigger } from '@langgenius/dify-ui/alert-dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import useTimestamp from '@/hooks/use-timestamp'
import { maskApiKey } from './mask-api-key'

export type ApiKeyDeleteTarget = Pick<ApiKeyItem, 'id' | 'token'>

type ApiKeyTableProps = {
  apiKeys: Array<ApiKeyItem | EnvironmentApiKey>
  canManage: boolean
  // Dataset keys carry a knowledge-base scope; enable the SCOPE column to surface it.
  showScope?: boolean
  allowCopy?: boolean
}

export function ApiKeyTable({
  apiKeys,
  canManage,
  showScope = false,
  allowCopy = false,
}: ApiKeyTableProps) {
  const { t } = useTranslation(['appApi', 'common', 'time'])
  const { formatTime } = useTimestamp()

  // Only dataset keys expose bound knowledge bases (legacy dataset_ids plus KnowledgeFS
  // knowledge_space_ids); both empty/absent means the key can access every knowledge base
  // in the workspace.
  const scopeLabel = (apiKey: ApiKeyItem | EnvironmentApiKey) => {
    const datasetIds = 'dataset_ids' in apiKey ? apiKey.dataset_ids : undefined
    const knowledgeSpaceIds =
      'knowledge_space_ids' in apiKey ? apiKey.knowledge_space_ids : undefined
    const count = (datasetIds?.length ?? 0) + (knowledgeSpaceIds?.length ?? 0)
    if (!count) return t(($) => $['apiKeyModal.scopeAllDatasets'], { ns: 'appApi' })
    return t(($) => $['apiKeyModal.scopeCount'], { ns: 'appApi', count })
  }

  return (
    <div className="mx-6 min-h-0 min-w-0 overflow-auto border-y border-divider-subtle">
      <table className="w-full min-w-180 table-fixed text-left system-sm-regular text-text-secondary">
        <caption className="sr-only">
          {t(($) => $['apiKeyModal.apiSecretKey'], { ns: 'appApi' })}
        </caption>
        <thead className="sticky top-0 bg-components-panel-bg system-xs-semibold-uppercase text-text-tertiary">
          <tr className="border-b border-divider-regular">
            <th className="w-60 px-3 py-2" scope="col">
              {t(($) => $['apiKeyModal.secretKey'], { ns: 'appApi' })}
            </th>
            {showScope && (
              <th className="w-28 px-3 py-2" scope="col">
                {t(($) => $['apiKeyModal.scope'], { ns: 'appApi' })}
              </th>
            )}
            <th className="w-40 px-3 py-2" scope="col">
              {t(($) => $['apiKeyModal.created'], { ns: 'appApi' })}
            </th>
            <th className="w-40 px-3 py-2" scope="col">
              {t(($) => $['apiKeyModal.lastUsed'], { ns: 'appApi' })}
            </th>
            <th className="w-28 px-3 py-2" scope="col">
              <span className="sr-only">
                {t(($) => $['apiKeyModal.actions'], { ns: 'appApi' })}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {apiKeys.length === 0 && (
            <tr>
              <td colSpan={showScope ? 5 : 4} className="h-20 px-6 text-center text-text-tertiary">
                {t(($) => $['apiKeyModal.emptyState'], { ns: 'appApi' })}
              </td>
            </tr>
          )}
          {apiKeys.map((apiKey) => (
            <tr className="border-b border-divider-regular last:border-b-0" key={apiKey.id}>
              <td className="truncate px-3 py-2 font-mono">{maskApiKey(apiKey.token)}</td>
              {showScope && <td className="truncate px-3 py-2">{scopeLabel(apiKey)}</td>}
              <td className="truncate px-3 py-2">
                {apiKey.created_at == null
                  ? '—'
                  : formatTime(
                      apiKey.created_at,
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
              <td className="px-3 py-1">
                <div className="flex justify-end gap-1">
                  {allowCopy && <CopyFeedback content={apiKey.token} />}
                  {canManage && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <AlertDialogTrigger
                            id={apiKey.id}
                            payload={apiKey}
                            render={
                              <IconButton
                                tone="destructive"
                                aria-label={`${t(($) => $['operation.delete'], { ns: 'common' })} ${maskApiKey(apiKey.token)}`}
                              >
                                <span aria-hidden className="i-ri-delete-bin-line size-4" />
                              </IconButton>
                            }
                          />
                        }
                      />
                      <TooltipContent>
                        {t(($) => $['operation.delete'], { ns: 'common' })}
                      </TooltipContent>
                    </Tooltip>
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
