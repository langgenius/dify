import type { TableCell, TableColumn } from '@/framework/output'

const ACTIVE_MARKER = '*'

const LIST_COLUMNS: readonly TableColumn[] = [
  { name: 'HOST', priority: 0 },
  { name: 'ACCOUNT', priority: 0 },
  { name: 'ACTIVE', priority: 0 },
]

export class ContextRow {
  readonly host: string
  readonly account: string
  readonly displayName: string
  readonly active: boolean

  constructor(host: string, account: string, displayName: string, active: boolean) {
    this.host = host
    this.account = account
    this.displayName = displayName
    this.active = active
  }

  tableRow(): readonly TableCell[] {
    const accountCell = this.displayName ? `${this.account} (${this.displayName})` : this.account
    return [this.host, accountCell, this.active ? ACTIVE_MARKER : '']
  }

  name(): string {
    return this.account
  }

  json() {
    return {
      host: this.host,
      account: this.account,
      name: this.displayName,
      active: this.active,
    }
  }
}

export class ContextListOutput {
  readonly rows: readonly ContextRow[]

  constructor(rows: readonly ContextRow[]) {
    this.rows = rows
  }

  tableColumns(): readonly TableColumn[] {
    return LIST_COLUMNS
  }

  tableRows(): readonly (readonly TableCell[])[] {
    return this.rows.map(r => r.tableRow())
  }

  name(): string {
    return this.rows.map(r => r.name()).join('\n')
  }

  json() {
    return { contexts: this.rows.map(r => r.json()) }
  }
}
