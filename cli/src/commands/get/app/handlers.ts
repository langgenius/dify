import type { TableColumn, TableHandler, TableRow } from '../../../printers/format-table.js'
import type { AppListResponse, TagItem } from '../../../types/data-contracts.js'
import { isPayloadShape } from './payload-shape.js'

export const APP_MODE_KEY = 'app'

export type AppObject = {
  mode: () => string
  raw: () => AppListResponse
}

export function newAppObject(env: AppListResponse): AppObject {
  return {
    mode: () => APP_MODE_KEY,
    raw: () => env,
  }
}

const APP_COLUMNS: readonly TableColumn[] = [
  { name: 'NAME', priority: 0 },
  { name: 'ID', priority: 0 },
  { name: 'MODE', priority: 0 },
  { name: 'TAGS', priority: 0 },
  { name: 'UPDATED', priority: 0 },
  { name: 'AUTHOR', priority: 1 },
  { name: 'WORKSPACE', priority: 1 },
]

export const appTableHandler: TableHandler = {
  columns: () => APP_COLUMNS,
  rows: (raw): readonly TableRow[] => {
    if (!isPayloadShape<AppListResponse>(raw, 'data'))
      throw new Error('get/app table: unexpected payload shape')
    return raw.data.map(r => [
      r.name,
      r.id,
      r.mode,
      joinTags(r.tags ?? []),
      r.updated_at ?? '',
      r.created_by_name ?? '',
      r.workspace_name ?? '',
    ])
  },
}

export const appNameHandler = {
  id(raw: unknown): string {
    if (!isPayloadShape<AppListResponse>(raw, 'data'))
      throw new Error('get/app name: unexpected payload shape')
    if (raw.data.length === 0)
      return ''
    return raw.data.map(r => r.id).join('\n')
  },
}

function joinTags(tags: readonly TagItem[]): string {
  return tags.map(t => t.name).join(',')
}
