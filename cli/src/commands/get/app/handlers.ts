import type { TableCell } from '../../../framework/output.js'
import type { TableColumn, TableHandler, TableRow } from '../../../printers/format-table.js'
import type { AppListResponse, AppListRow, TagItem } from '../../../types/data-contracts.js'
import { isPayloadShape } from './payload-shape.js'

export const APP_MODE_KEY = 'app'

export const APP_COLUMNS: readonly TableColumn[] = [
  { name: 'NAME', priority: 0 },
  { name: 'ID', priority: 0 },
  { name: 'MODE', priority: 0 },
  { name: 'TAGS', priority: 0 },
  { name: 'UPDATED', priority: 0 },
  { name: 'AUTHOR', priority: 1 },
  { name: 'WORKSPACE', priority: 1 },
]

export class AppRow {
  readonly data: AppListRow

  constructor(data: AppListRow) {
    this.data = data
  }

  tableRow(): readonly TableCell[] {
    return [
      this.data.name,
      this.data.id,
      this.data.mode,
      joinTags(this.data.tags ?? []),
      this.data.updated_at ?? '',
      this.data.created_by_name ?? '',
      this.data.workspace_name ?? '',
    ]
  }

  name(): string {
    return this.data.id
  }

  json(): AppListRow {
    return this.data
  }
}

export class AppListOutput {
  readonly rows: readonly AppRow[]
  readonly envelope: AppListResponse

  constructor(rows: readonly AppRow[], envelope: AppListResponse) {
    this.rows = rows
    this.envelope = envelope
  }

  static tableColumns(): readonly TableColumn[] {
    return APP_COLUMNS
  }

  tableColumns(): readonly TableColumn[] {
    return AppListOutput.tableColumns()
  }

  tableRows(): readonly (readonly TableCell[])[] {
    return this.rows.map(row => row.tableRow())
  }

  name(): string {
    return this.rows.map(row => row.name()).join('\n')
  }

  json(): AppListResponse {
    return this.envelope
  }
}

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
