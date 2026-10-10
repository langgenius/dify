'use client'

import type { ResourceAccessTokenRowResponse } from '@dify/contracts/api/console/resource-access-tokens/types.gen'
import type { TokenTableRow } from './types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import ResourceAccessTokenRow from './token-table-row'

const getTokenRows = (rows: ResourceAccessTokenRowResponse[]) => {
  const rowMap = new Map<string, TokenTableRow>()

  rows.forEach((row) => {
    const tokenRow = rowMap.get(row.token_id)
    if (tokenRow) {
      tokenRow.relations.push(row)
      return
    }

    rowMap.set(row.token_id, {
      tokenId: row.token_id,
      name: row.name,
      trackId: row.track_id,
      maskedToken: row.masked_token,
      createdAt: row.created_at,
      relations: [row],
    })
  })

  return Array.from(rowMap.values())
}

export default function ResourceAccessTokenTable({
  rows,
  isPending,
  onEdit,
  onDelete,
}: {
  rows: ResourceAccessTokenRowResponse[] | undefined
  isPending: boolean
  onEdit: (row: TokenTableRow) => void
  onDelete: (row: ResourceAccessTokenRowResponse) => void
}) {
  const { t } = useTranslation(['accountSettings'])
  const tokenRows = useMemo(() => getTokenRows(rows ?? []), [rows])

  return (
    <div className="max-h-[min(32rem,60vh)] overflow-auto overscroll-contain">
      <table className="w-full min-w-225 table-fixed text-left">
        <colgroup>
          <col className="w-1/5" />
          <col className="w-1/6" />
          <col className="w-1/6" />
          <col />
          <col className="w-1/6" />
          <col className="w-20" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-components-panel-bg system-xs-medium-uppercase text-text-tertiary">
          <tr className="border-b border-divider-subtle">
            <th scope="col" className="pr-6 pb-3 font-medium">
              {t(($) => $['resourceAccessToken.name'], { ns: 'accountSettings' })}
            </th>
            <th scope="col" className="pr-6 pb-3 font-medium">
              {t(($) => $['resourceAccessToken.trackingId'], { ns: 'accountSettings' })}
            </th>
            <th scope="col" className="pr-6 pb-3 font-medium">
              {t(($) => $['resourceAccessToken.token'], { ns: 'accountSettings' })}
            </th>
            <th scope="col" className="pr-6 pb-3 font-medium">
              {t(($) => $['resourceAccessToken.accessibleResources'], {
                ns: 'accountSettings',
              })}
            </th>
            <th scope="col" className="pr-6 pb-3 font-medium">
              {t(($) => $['resourceAccessToken.createdColumn'], { ns: 'accountSettings' })}
            </th>
            <th scope="col" className="pb-3 font-medium">
              {t(($) => $['resourceAccessToken.actions'], { ns: 'accountSettings' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {isPending && (
            <tr>
              <td colSpan={6} className="py-4">
                <div className="grid gap-2">
                  <SkeletonRectangle className="h-12 w-full animate-pulse" />
                  <SkeletonRectangle className="h-12 w-full animate-pulse" />
                </div>
              </td>
            </tr>
          )}
          {!isPending &&
            tokenRows.map((row) => (
              <ResourceAccessTokenRow
                key={row.tokenId}
                row={row}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          {!isPending && tokenRows.length === 0 && (
            <tr>
              <td colSpan={6} className="p-10 text-center system-sm-regular text-text-tertiary">
                {t(($) => $['resourceAccessToken.empty'], { ns: 'accountSettings' })}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
