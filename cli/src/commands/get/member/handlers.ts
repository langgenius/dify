import type { MemberListResponse, MemberResponse } from '@dify/contracts/api/openapi/types.gen'
import type { TableCell, TableColumn } from '@/framework/output'

export const MEMBER_MODE_KEY = 'member'
const CURRENT_MARKER = '*'

export const MEMBER_COLUMNS: readonly TableColumn[] = [
  { name: 'ID', priority: 0 },
  { name: 'NAME', priority: 0 },
  { name: 'EMAIL', priority: 0 },
  { name: 'ROLE', priority: 0 },
  { name: 'STATUS', priority: 0 },
  { name: 'CURRENT', priority: 0 },
]

export class MemberRow {
  readonly id: string
  readonly displayName: string
  readonly email: string
  readonly role: string
  readonly status: string
  readonly current: boolean

  constructor(member: MemberResponse, current: boolean) {
    this.id = member.id
    this.displayName = member.name
    this.email = member.email
    this.role = member.role
    this.status = member.status
    this.current = current
  }

  tableRow(): readonly TableCell[] {
    return [
      this.id,
      this.displayName,
      this.email,
      this.role,
      this.status,
      this.current ? CURRENT_MARKER : '',
    ]
  }

  name(): string {
    return this.id
  }

  json() {
    return {
      id: this.id,
      name: this.displayName,
      email: this.email,
      role: this.role,
      status: this.status,
      current: this.current,
    }
  }
}

export class MemberListOutput {
  readonly rows: readonly MemberRow[]
  readonly envelope: MemberListResponse

  constructor(rows: readonly MemberRow[], envelope: MemberListResponse) {
    this.rows = rows
    this.envelope = envelope
  }

  static tableColumns(): readonly TableColumn[] {
    return MEMBER_COLUMNS
  }

  tableColumns(): readonly TableColumn[] {
    return MemberListOutput.tableColumns()
  }

  tableRows(): readonly (readonly TableCell[])[] {
    return this.rows.map(row => row.tableRow())
  }

  name(): string {
    return this.rows.map(row => row.name()).join('\n')
  }

  json(): MemberListResponse {
    return this.envelope
  }
}
