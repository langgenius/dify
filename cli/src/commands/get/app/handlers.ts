import type { AppListResponse, AppListRow, TagItem } from '@dify/contracts/api/openapi/types.gen'
import type { TableCell, TableColumn } from '@/framework/output'

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

function joinTags(tags: readonly TagItem[]): string {
  return tags.map(t => t.name).join(',')
}
