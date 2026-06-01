import yaml from 'js-yaml'
import { OutputFormatNotSupportedError } from './errors'

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

export const OutputFormat = {
  NAME: 'name',
  JSON: 'json',
  YAML: 'yaml',
  TEXT: 'text',
  WIDE: 'wide',
} as const

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
    case OutputFormat.TEXT:
      return output.data.text()
    case OutputFormat.JSON:
      return `${JSON.stringify(output.data.json(), null, 2)}\n`
    case OutputFormat.YAML:
      return yaml.dump(output.data.json(), { indent: 2, lineWidth: -1 })
    case OutputFormat.NAME:
      return `${toName(output.data)}\n`
    default:
      throw new OutputFormatNotSupportedError(output.format)
  }
}

function stringifyTableOutput(output: TableOutput<TablePrintable>): string {
  switch (output.format) {
    case '':
    case OutputFormat.WIDE:
      return renderTable(output)
    case OutputFormat.JSON:
      return `${JSON.stringify(output.data.json(), null, 2)}\n`
    case OutputFormat.YAML:
      return yaml.dump(output.data.json(), { indent: 2, lineWidth: -1 })
    case OutputFormat.NAME:
      return `${toName(output.data)}\n`
    default:
      throw new OutputFormatNotSupportedError(output.format)
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

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115F)
    || cp === 0x2329 || cp === 0x232A
    || (cp >= 0x2E80 && cp <= 0x3247)
    || (cp >= 0x3250 && cp <= 0x4DBF)
    || (cp >= 0x4E00 && cp <= 0xA4C6)
    || (cp >= 0xA960 && cp <= 0xA97C)
    || (cp >= 0xAC00 && cp <= 0xD7A3)
    || (cp >= 0xF900 && cp <= 0xFAFF)
    || (cp >= 0xFE10 && cp <= 0xFE19)
    || (cp >= 0xFE30 && cp <= 0xFE6B)
    || (cp >= 0xFF01 && cp <= 0xFF60)
    || (cp >= 0xFFE0 && cp <= 0xFFE6)
    || (cp >= 0x1B000 && cp <= 0x1B001)
    || (cp >= 0x1F200 && cp <= 0x1F251)
    || (cp >= 0x20000 && cp <= 0x3FFFD)
  )
}

function displayWidth(s: string): number {
  let w = 0
  for (const ch of s)
    w += isWideCodePoint(ch.codePointAt(0) ?? 0) ? 2 : 1
  return w
}

function formatTable(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0)
    return ''
  const colCount = rows[0]?.length ?? 0
  const widths: number[] = Array.from({ length: colCount }, () => 0)
  for (const row of rows) {
    for (let i = 0; i < colCount; i++) {
      const cell = row[i] ?? ''
      const w = displayWidth(cell)
      if (w > (widths[i] ?? 0))
        widths[i] = w
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
        const pad = (widths[i] ?? 0) - displayWidth(cell) + 2
        cells.push(cell + ' '.repeat(pad))
      }
    }
    return cells.join('')
  })
  return `${lines.join('\n')}\n`
}

function toName(data: TablePrintable | FormattedPrintable): string {
  if (!isNamePrintable(data))
    throw new OutputFormatNotSupportedError('name')
  return data.name()
}

function isNamePrintable(data: TablePrintable | FormattedPrintable): data is (TablePrintable | FormattedPrintable) & NamePrintable {
  return typeof (data as { name?: unknown }).name === 'function'
}
