'use client'

/**
 * TableCopy
 *
 * Dify-owned replacement for the markdown `table` renderer. It renders the
 * table exactly as streamdown would, but adds a copy control (Markdown / CSV /
 * TSV) in the top-right corner.
 *
 * Fix for https://github.com/langgenius/dify/issues/38790
 * --------------------------------------------------------------------------
 * The upstream table-copy path wrote the chosen format to the clipboard using
 * ONLY its native MIME type (e.g. `text/markdown`). Plain-text editors such as
 * Notepad do not understand `text/markdown`, so a "Copy as Markdown" produced an
 * empty paste there — while the identical CSV / TSV options worked because they
 * are recognised as plain text.
 *
 * This component always writes a `text/plain` fallback alongside the format's
 * native MIME type via the `ClipboardItem` API, so the copied content pastes
 * correctly into every target (plain-text editors, Excel, StackEdit, …) while
 * still preserving rich formatting for apps that consume `text/markdown`.
 */

import { memo, useCallback, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type TableCopyFormat = 'markdown' | 'csv' | 'tsv'

type Props = {
  children?: ReactNode
}

const extractTableElement = (children: ReactNode): HTMLTableElement | null => {
  if (!children || typeof document === 'undefined') return null

  // streamdown renders a real <table> element as the single child.
  const maybeTable = (children as any)?.props?.node?.children?.[0]

  if (maybeTable && maybeTable.tagName === 'table') return maybeTable as HTMLTableElement

  // Fallback: walk the rendered DOM for the first <table>.
  if (typeof document !== 'undefined') {
    return document.querySelector('table')
  }
  return null
}

export const tableElementToMatrix = (table: HTMLTableElement): string[][] => {
  const rows = Array.from(table.querySelectorAll('tr'))
  return rows.map((row) => {
    const cells = Array.from(row.querySelectorAll('th, td'))
    return cells.map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
  })
}

export const matrixToMarkdown = (matrix: string[][]): string => {
  if (matrix.length === 0) return ''
  const escape = (value: string) => value.replace(/\|/g, '\\|')
  const header = matrix[0]
  const divider = header.map(() => '---')
  const body = matrix.slice(1)
  const lines = [
    header.map(escape).join(' | '),
    divider.join(' | '),
    ...body.map((r) => r.map(escape).join(' | ')),
  ]
  return lines.join('\n')
}

export const matrixToCsv = (matrix: string[][]): string => {
  const escape = (value: string) => {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
    return value
  }
  return matrix.map((row) => row.map(escape).join(',')).join('\n')
}

export const matrixToTsv = (matrix: string[][]): string => {
  return matrix.map((row) => row.join('\t')).join('\n')
}

const FORMAT_BUILDERS: Record<TableCopyFormat, (matrix: string[][]) => string> = {
  markdown: matrixToMarkdown,
  csv: matrixToCsv,
  tsv: matrixToTsv,
}

const FORMAT_MIME: Record<TableCopyFormat, string> = {
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
}

/**
 * Write `content` to the clipboard as the native `formatMime` type AND as a
 * `text/plain` fallback. When the richer ClipboardItem API is unavailable
 * (or denied) we degrade gracefully to `writeText`, which always targets
 * `text/plain`.
 */
export const writeTableToClipboard = async (
  content: string,
  formatMime: string,
): Promise<void> => {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof window.ClipboardItem !== 'undefined'
  ) {
    const item = new window.ClipboardItem({
      [formatMime]: new Blob([content], { type: formatMime }),
      // Plain-text fallback so the content also pastes into editors that do
      // not understand `text/markdown` / `text/csv` / `text/tab-separated-values`.
      'text/plain': new Blob([content], { type: 'text/plain' }),
    })
    await navigator.clipboard.write([item])
    return
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(content)
    return
  }

  throw new Error('Clipboard API is not available in this context')
}

const TableCopy = ({ children }: Props) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<number | null>(null)

  const handleCopy = useCallback(
    async (format: TableCopyFormat) => {
      const table = extractTableElement(children)
      if (!table) return
      const matrix = tableElementToMatrix(table)
      const content = FORMAT_BUILDERS[format](matrix)
      try {
        await writeTableToClipboard(content, FORMAT_MIME[format])
        setCopied(true)
        if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
        timeoutRef.current = window.setTimeout(() => setCopied(false), 2000)
      } catch {
        // Clipboard denied — nothing we can do here; swallow like streamdown.
      } finally {
        setOpen(false)
      }
    },
    [children],
  )

  const options: {
    format: TableCopyFormat
    labelKey: 'operation.copyTableAsMarkdown' | 'operation.copyTableAsCsv' | 'operation.copyTableAsTsv'
  }[] = [
    { format: 'markdown', labelKey: 'operation.copyTableAsMarkdown' },
    { format: 'csv', labelKey: 'operation.copyTableAsCsv' },
    { format: 'tsv', labelKey: 'operation.copyTableAsTsv' },
  ]

  return (
    <div className="relative group/table-copy">
      <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover/table-copy:opacity-100">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t(($) => $('operation.copyTable'), { ns: 'common' })}
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-components-panel-border bg-components-panel-bg text-text-tertiary transition-colors hover:text-text-primary"
          onClick={() => setOpen((v) => !v)}
        >
          <span className={copied ? 'i-lucide-check size-3.5' : 'i-lucide-copy size-3.5'} aria-hidden />
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 top-8 w-40 rounded-md border border-components-panel-border bg-components-panel-bg p-1 shadow-lg"
          >
            {options.map((opt) => (
              <button
                key={opt.format}
                type="button"
                role="menuitem"
                className="block w-full rounded px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-state-base-hover"
                onClick={() => handleCopy(opt.format)}
              >
                {t(($) => $(opt.labelKey), { ns: 'common' })}
              </button>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

TableCopy.displayName = 'TableCopy'

export default memo(TableCopy)
