import type { WorkspaceListResponse } from '@dify/contracts/api/openapi/types.gen'
import type { TableCell, TableColumn } from '@/framework/output'

const CURRENT_MARKER = '*'

export const WORKSPACE_COLUMNS: readonly TableColumn[] = [
  { name: 'ID', priority: 0 },
  { name: 'NAME', priority: 0 },
  { name: 'ROLE', priority: 0 },
  { name: 'STATUS', priority: 0 },
  { name: 'CURRENT', priority: 0 },
]

export class WorkspaceRow {
  readonly id: string
  readonly displayName: string
  readonly role: string
  readonly status: string
  readonly current: boolean

  constructor(id: string, displayName: string, role: string, status: string, current: boolean) {
    this.id = id
    this.displayName = displayName
    this.role = role
    this.status = status
    this.current = current
  }

  tableRow(): readonly TableCell[] {
    return [this.id, this.displayName, this.role, this.status, this.current ? CURRENT_MARKER : '']
  }

  name(): string {
    return this.id
  }

  json() {
    return {
      id: this.id,
      name: this.displayName,
      role: this.role,
      status: this.status,
      current: this.current,
    }
  }
}

export class WorkspaceListOutput {
  readonly rows: readonly WorkspaceRow[]
  readonly envelope: WorkspaceListResponse

  constructor(rows: readonly WorkspaceRow[], envelope: WorkspaceListResponse) {
    this.rows = rows
    this.envelope = envelope
  }

  static tableColumns(): readonly TableColumn[] {
    return WORKSPACE_COLUMNS
  }

  tableColumns(): readonly TableColumn[] {
    return WorkspaceListOutput.tableColumns()
  }

  tableRows(): readonly (readonly TableCell[])[] {
    return this.rows.map((row) => row.tableRow())
  }

  name(): string {
    return this.rows.map((row) => row.name()).join('\n')
  }

  json(): WorkspaceListResponse {
    return this.envelope
  }
}
