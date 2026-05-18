import yaml from 'js-yaml'

export type RawOutput = {
  readonly kind: 'raw'
  readonly data: string
}

export type TableCell = string | number | boolean | null | undefined

export type TableColumn = {
  readonly name: string
  readonly priority: number
}

export type TablePrintable = {
  readonly tableColumns: () => readonly TableColumn[]
  readonly tableRows: () => readonly (readonly TableCell[])[]
  readonly json: () => unknown
}

export type FormattedPrintable = {
  readonly text: () => string
  readonly json: () => unknown
}

export type NamePrintable = {
  readonly name: () => string
}

export type JsonPrintable = {
  readonly json: () => unknown
}

export type TableOutput<TRow extends TablePrintable> = {
  readonly kind: 'table'
  readonly format: string
  readonly data: TRow
}

export type FormattedOutput<TData extends FormattedPrintable> = {
  readonly kind: 'formatted'
  readonly format: string
  readonly data: TData
}

export type CommandOutput = RawOutput | TableOutput<TablePrintable> | FormattedOutput<FormattedPrintable>

export function raw(data: string): RawOutput {
  return { kind: 'raw', data }
}

export function table<TRow extends TablePrintable>(opts: {
  readonly format: string
  readonly data: TRow
}): TableOutput<TRow> {
  return { kind: 'table', ...opts }
}

export function formatted<TData extends FormattedPrintable>(opts: {
  readonly format: string
  readonly data: TData
}): FormattedOutput<TData> {
  return { kind: 'formatted', ...opts }
}

export function stringifyOutput(output: CommandOutput): string {
  switch (output.kind) {
    case 'raw':
      return output.data
    case 'table':
      return stringifyTableOutput(output)
    case 'formatted':
      return stringifyFormattedOutput(output)
  }
}

function stringifyFormattedOutput(output: FormattedOutput<FormattedPrintable>): string {
  switch (output.format) {
    case '':
    case 'text':
      return output.data.text()
    case 'json':
      return `${JSON.stringify(output.data.json(), null, 2)}\n`
    case 'yaml':
      return yaml.dump(output.data.json(), { indent: 2, lineWidth: -1 })
    case 'name':
      return `${toName(output.data)}\n`
    default:
      throw new Error(`output format ${JSON.stringify(output.format)} not supported, allowed: json, name, text, yaml`)
  }
}

function stringifyTableOutput(output: TableOutput<TablePrintable>): string {
  switch (output.format) {
    case '':
    case 'wide':
      return renderTable(output)
    case 'json':
      return `${JSON.stringify(output.data.json(), null, 2)}\n`
    case 'yaml':
      return yaml.dump(output.data.json(), { indent: 2, lineWidth: -1 })
    case 'name':
      return `${toName(output.data)}\n`
    default:
      throw new Error(`output format ${JSON.stringify(output.format)} not supported, allowed: json, name, wide, yaml`)
  }
}

function renderTable(output: TableOutput<TablePrintable>): string {
  const wide = output.format === 'wide'
  const columns = output.data.tableColumns()
  const keep: number[] = []
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i]
    if (column !== undefined && (column.priority === 0 || wide))
      keep.push(i)
  }

  const rows = [
    keep.map(i => columns[i]?.name ?? ''),
    ...output.data.tableRows().map(row => keep.map((idx) => {
      const cell = row[idx]
      return cell === null || cell === undefined ? '' : String(cell)
    })),
  ]
  return formatTable(rows)
}

function formatTable(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0)
    return ''
  const colCount = rows[0]?.length ?? 0
  const widths: number[] = Array.from({ length: colCount }, () => 0)
  for (const row of rows) {
    for (let i = 0; i < colCount; i++) {
      const cell = row[i] ?? ''
      if (cell.length > (widths[i] ?? 0))
        widths[i] = cell.length
    }
  }
  const lines = rows.map((row) => {
    const cells: string[] = []
    for (let i = 0; i < colCount; i++) {
      const cell = row[i] ?? ''
      const isLast = i === colCount - 1
      if (isLast) {
        cells.push(cell)
      }
      else {
        const pad = (widths[i] ?? 0) - cell.length + 2
        cells.push(cell + ' '.repeat(pad))
      }
    }
    return cells.join('')
  })
  return `${lines.join('\n')}\n`
}

function toName(data: TablePrintable | FormattedPrintable): string {
  if (!isNamePrintable(data))
    throw new Error('name output requires data.name()')
  return data.name()
}

function isNamePrintable(data: TablePrintable | FormattedPrintable): data is (TablePrintable | FormattedPrintable) & NamePrintable {
  return typeof (data as { name?: unknown }).name === 'function'
}
