import type { Printer, PrintFlags } from './printer.js'
import { isModer, NoCompatiblePrinterError, payload } from './printer.js'

const ALLOWED = ['', 'wide'] as const
const COLUMN_PADDING = 2

export type TableColumn = {
  name: string
  priority: number
}

export type TableCell = string | null | undefined

export type TableRow = readonly TableCell[]

export type TableHandler = {
  columns: () => readonly TableColumn[]
  rows: (raw: unknown) => readonly TableRow[]
}

export type TablePrintFlagsOptions = {
  noHeaders?: boolean
}

export class TablePrintFlags implements PrintFlags {
  private readonly handlers = new Map<string, TableHandler>()
  private readonly noHeaders: boolean

  constructor(opts: TablePrintFlagsOptions = {}) {
    this.noHeaders = opts.noHeaders ?? false
  }

  register(handler: TableHandler, ...keys: string[]): void {
    for (const k of keys) this.handlers.set(k, handler)
  }

  allowedFormats(): readonly string[] {
    return ALLOWED
  }

  toPrinter(format: string): Printer {
    if (format !== '' && format !== 'wide')
      throw new NoCompatiblePrinterError(format, ALLOWED)
    const wide = format === 'wide'
    const handlers = this.handlers
    const noHeaders = this.noHeaders
    return {
      print(obj) {
        if (!isModer(obj))
          throw new Error('table printer: payload does not implement Moder')
        const mode = obj.mode()
        const handler = handlers.get(mode)
        if (handler === undefined) {
          const known = [...handlers.keys()].sort().join(', ')
          throw new Error(`table printer: no handler for mode "${mode}" (registered: ${known})`)
        }
        const cols = handler.columns()
        const keep: number[] = []
        for (let i = 0; i < cols.length; i++) {
          const col = cols[i]
          if (col !== undefined && (col.priority === 0 || wide))
            keep.push(i)
        }
        const rows = handler.rows(payload(obj))
        const stringRows: string[][] = rows.map(row =>
          keep.map((idx) => {
            const cell = row[idx]
            return cell === null || cell === undefined ? '' : String(cell)
          }),
        )
        const allRows: string[][] = noHeaders
          ? stringRows
          : [keep.map(i => cols[i]?.name ?? ''), ...stringRows]
        return formatTable(allRows)
      },
    }
  }
}

function formatTable(rows: readonly string[][]): string {
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
        const pad = (widths[i] ?? 0) - cell.length + COLUMN_PADDING
        cells.push(cell + ' '.repeat(pad))
      }
    }
    return cells.join('')
  })
  return `${lines.join('\n')}\n`
}
