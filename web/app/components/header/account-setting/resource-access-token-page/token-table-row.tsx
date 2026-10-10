'use client'

import type { ResourceAccessTokenRowResponse } from '@dify/contracts/api/console/resource-access-tokens/types.gen'
import type { TFunction } from 'i18next'
import type { TokenTableRow } from './types'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'

const getResourceSummary = (
  relations: ResourceAccessTokenRowResponse[],
  t: TFunction<['common', 'accountSettings']>,
) => {
  const appCount = relations.filter((relation) => relation.resource_type === 'app').length
  const knowledgeCount = relations.filter(
    (relation) => relation.resource_type === 'knowledge',
  ).length
  const parts: string[] = []

  if (appCount)
    parts.push(
      t(
        ($) => $[appCount === 1 ? 'resourceAccessToken.appCount' : 'resourceAccessToken.appsCount'],
        { ns: 'accountSettings', count: appCount },
      ),
    )
  if (knowledgeCount)
    parts.push(
      t(
        ($) =>
          $[
            knowledgeCount === 1
              ? 'resourceAccessToken.knowledgeCount'
              : 'resourceAccessToken.knowledgesCount'
          ],
        { ns: 'accountSettings', count: knowledgeCount },
      ),
    )

  return parts.join(' · ')
}

export default function ResourceAccessTokenRow({
  row,
  onEdit,
  onDelete,
}: {
  row: TokenTableRow
  onEdit: (row: TokenTableRow) => void
  onDelete: (row: ResourceAccessTokenRowResponse) => void
}) {
  const { t } = useTranslation(['common', 'accountSettings', 'time'])
  const { formatTime } = useTimestamp()
  const editRow = row.relations[0]
  const resourceSummary = getResourceSummary(row.relations, t)

  if (!editRow) return null

  return (
    <tr className="border-b border-divider-subtle system-md-regular last:border-b-0">
      <td className="h-12 pr-6">
        <div className="truncate system-md-regular text-text-secondary">{row.name}</div>
      </td>
      <td className="pr-6">
        <div className="truncate font-mono text-text-secondary">{row.trackId}</div>
      </td>
      <td className="pr-6">
        <div className="truncate font-mono text-text-secondary">{row.maskedToken}</div>
      </td>
      <td className="pr-6">
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 truncate text-text-secondary">
            {resourceSummary ||
              t(($) => $['resourceAccessToken.noAccessibleResources'], { ns: 'accountSettings' })}
          </div>
          <Infotip>
            <InfotipTrigger
              iconVariant="information"
              aria-label={`${row.name} · ${t(($) => $['resourceAccessToken.accessibleResources'], { ns: 'accountSettings' })}`}
            />
            <InfotipContent
              aria-label={`${row.name} · ${t(($) => $['resourceAccessToken.accessibleResources'], { ns: 'accountSettings' })}`}
            >
              <div className="grid max-h-60 min-w-48 gap-3 overflow-y-auto">
                {(['app', 'knowledge'] as const).map((type) => {
                  const resources = row.relations.filter(
                    (relation) => relation.resource_type === type,
                  )
                  if (resources.length === 0) return null
                  const label = t(
                    ($) =>
                      $[
                        type === 'app'
                          ? 'resourceAccessToken.appsSection'
                          : 'resourceAccessToken.knowledgeBasesSection'
                      ],
                    { ns: 'accountSettings' },
                  )
                  return (
                    <div key={type}>
                      <div className="mb-1 system-xs-semibold text-text-secondary">{label}</div>
                      <ul aria-label={label} className="grid gap-1">
                        {resources.map((resource) => (
                          <li key={resource.relation_id} className="wrap-break-word">
                            {resource.resource_name || resource.resource_id}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </InfotipContent>
          </Infotip>
        </div>
      </td>
      <td className="pr-6">
        <div className="truncate text-text-secondary">
          {row.createdAt != null
            ? formatTime(
                row.createdAt,
                t(($) => $['dateFormats.compact'], { ns: 'time' }),
              )
            : '-'}
        </div>
      </td>
      <td>
        <div className="flex items-center gap-1">
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t(($) => $['operation.edit'], { ns: 'common' })}
            onClick={() => onEdit(row)}
          >
            <span aria-hidden className="i-ri-edit-line size-4" />
          </IconButton>
          <IconButton
            size="sm"
            variant="ghost"
            tone="destructive"
            aria-label={t(($) => $['operation.delete'], { ns: 'common' })}
            onClick={() => onDelete(editRow)}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
          </IconButton>
        </div>
      </td>
    </tr>
  )
}
