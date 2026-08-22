/**
 * Regression test for https://github.com/langgenius/dify/issues/38790
 *
 * The Markdown table copy path must write a `text/plain` fallback to the
 * clipboard (in addition to the native `text/markdown` MIME type) so the
 * content also pastes into plain-text editors such as Notepad.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  matrixToCsv,
  matrixToMarkdown,
  matrixToTsv,
  tableElementToMatrix,
  writeTableToClipboard,
} from '../table-copy'

const buildTable = (html: string): HTMLTableElement => {
  const container = document.createElement('div')
  container.innerHTML = html
  return container.querySelector('table') as HTMLTableElement
}

describe('table-copy format builders', () => {
  const table = buildTable(`
    <table>
      <thead><tr><th>Name</th><th>Score</th></tr></thead>
      <tbody>
        <tr><td>Alice</td><td>10</td></tr>
        <tr><td>Bob</td><td>20</td></tr>
      </tbody>
    </table>
  `)

  it('extracts a row/column matrix from the DOM table', () => {
    expect(tableElementToMatrix(table)).toEqual([
      ['Name', 'Score'],
      ['Alice', '10'],
      ['Bob', '20'],
    ])
  })

  it('builds a Markdown table (header + --- divider + body)', () => {
    const md = matrixToMarkdown(tableElementToMatrix(table))
    expect(md).toBe(['Name | Score', '--- | ---', 'Alice | 10', 'Bob | 20'].join('\n'))
  })

  it('escapes pipe characters in Markdown cells', () => {
    const t = buildTable('<table><tr><th>a|b</th></tr><tr><td>c|d</td></tr></table>')
    expect(matrixToMarkdown(tableElementToMatrix(t))).toBe('a\\|b\n---\nc\\|d')
  })

  it('builds a CSV with RFC-4180 quoting for commas/newlines', () => {
    const t = buildTable('<table><tr><th>note</th></tr><tr><td>hello, world</td></tr></table>')
    expect(matrixToCsv(tableElementToMatrix(t))).toBe('note\n"hello, world"')
  })

  it('builds a TSV using tab separators', () => {
    expect(matrixToTsv(tableElementToMatrix(table))).toBe(
      ['Name\tScore', 'Alice\t10', 'Bob\t20'].join('\n'),
    )
  })
})

describe('writeTableToClipboard — text/plain fallback (issue #38790)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error clean up
    delete window.ClipboardItem
  })

  class MockClipboardItem {
    types: Record<string, Blob>
    constructor(types: Record<string, Blob>) {
      this.types = types
    }
  }

  it('writes BOTH the native MIME type and a text/plain fallback via ClipboardItem', async () => {
    // @ts-expect-error install fake constructor
    window.ClipboardItem = MockClipboardItem

    const writeSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: writeSpy, writeText: vi.fn() },
      writable: true,
      configurable: true,
    })

    await writeTableToClipboard('| A | B |\n|---|---|', 'text/markdown')

    expect(writeSpy).toHaveBeenCalledTimes(1)
    const writtenItem = (writeSpy.mock.calls[0]![0] as MockClipboardItem[])[0]
    expect(writtenItem.types['text/markdown']).toBeInstanceOf(Blob)
    // THE FIX: a plain-text fallback must be present so Notepad/Excel can paste it.
    expect(writtenItem.types['text/plain']).toBeInstanceOf(Blob)
  })

  it('falls back to writeText (always plain text) when ClipboardItem is unavailable', async () => {
    // @ts-expect-error remove
    delete window.ClipboardItem
    const writeTextSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: undefined, writeText: writeTextSpy },
      writable: true,
      configurable: true,
    })

    await writeTableToClipboard('plain content', 'text/markdown')
    expect(writeTextSpy).toHaveBeenCalledWith('plain content')
  })
})
