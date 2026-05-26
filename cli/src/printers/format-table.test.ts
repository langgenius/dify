import type { TableColumn, TableHandler } from './format-table.js'
import { describe, expect, it } from 'vitest'
import { TablePrintFlags } from './format-table.js'
import { isNoCompatiblePrinter } from './printer.js'

const fakeMode = (m: string) => ({ mode: () => m })

const handler: TableHandler = {
  columns(): readonly TableColumn[] {
    return [
      { name: 'NAME', priority: 0 },
      { name: 'AGE', priority: 0 },
      { name: 'DETAILS', priority: 1 },
    ]
  },
  rows() {
    return [['alpha', '1d', 'extra']]
  },
}

describe('TablePrintFlags.allowedFormats', () => {
  it('returns ["", "wide"]', () => {
    expect(new TablePrintFlags().allowedFormats()).toEqual(['', 'wide'])
  })
})

describe('TablePrintFlags default format', () => {
  it('hides priority>0 columns and their cells', () => {
    const pf = new TablePrintFlags()
    pf.register(handler, 'thing')
    const out = pf.toPrinter('').print(fakeMode('thing'))
    expect(out).toContain('NAME')
    expect(out).toContain('AGE')
    expect(out).not.toContain('DETAILS')
    expect(out).not.toContain('extra')
    expect(out).toContain('alpha')
  })

  it('column-aligns cells with two-space padding', () => {
    const pf = new TablePrintFlags()
    pf.register({
      columns: () => [
        { name: 'NAME', priority: 0 },
        { name: 'AGE', priority: 0 },
      ],
      rows: () => [
        ['alpha', '1d'],
        ['beta-long', '999d'],
      ],
    }, 'thing')
    const out = pf.toPrinter('').print(fakeMode('thing'))
    const lines = out.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('NAME       AGE')
    expect(lines[1]).toBe('alpha      1d')
    expect(lines[2]).toBe('beta-long  999d')
  })
})

describe('TablePrintFlags wide format', () => {
  it('shows all columns including priority>0', () => {
    const pf = new TablePrintFlags()
    pf.register(handler, 'thing')
    const out = pf.toPrinter('wide').print(fakeMode('thing'))
    expect(out).toContain('DETAILS')
    expect(out).toContain('extra')
  })
})

describe('TablePrintFlags noHeaders', () => {
  it('omits header row when noHeaders=true', () => {
    const pf = new TablePrintFlags({ noHeaders: true })
    pf.register(handler, 'thing')
    const out = pf.toPrinter('').print(fakeMode('thing'))
    expect(out).not.toContain('NAME')
    expect(out).toContain('alpha')
  })
})

describe('TablePrintFlags errors', () => {
  it('throws NoCompatiblePrinterError for unsupported formats', () => {
    let caught: unknown
    try {
      new TablePrintFlags().toPrinter('json')
    }
    catch (e) {
      caught = e
    }
    expect(isNoCompatiblePrinter(caught)).toBe(true)
  })

  it('throws on unregistered mode', () => {
    const pf = new TablePrintFlags()
    pf.register(handler, 'thing')
    const printer = pf.toPrinter('')
    expect(() => printer.print(fakeMode('other'))).toThrow(/other/)
  })

  it('throws when payload does not implement Moder', () => {
    const pf = new TablePrintFlags()
    pf.register(handler, 'thing')
    expect(() => pf.toPrinter('').print({})).toThrow(/Moder/i)
  })

  it('handler rows() can return null/undefined cells safely (rendered empty)', () => {
    const pf = new TablePrintFlags()
    pf.register({
      columns: () => [{ name: 'A', priority: 0 }, { name: 'B', priority: 0 }],
      rows: () => [['x', undefined], [null, 'y']],
    }, 'thing')
    const out = pf.toPrinter('').print(fakeMode('thing'))
    const lines = out.trimEnd().split('\n')
    expect(lines[0]).toBe('A  B')
    expect(lines[1]).toBe('x  ')
    expect(lines[2]).toBe('   y')
  })
})

describe('TablePrintFlags raw unwrap', () => {
  it('passes unwrapped payload to handler.rows()', () => {
    let received: unknown
    const pf = new TablePrintFlags()
    pf.register({
      columns: () => [{ name: 'X', priority: 0 }],
      rows: (p) => {
        received = p
        return [['ok']]
      },
    }, 'thing')
    pf.toPrinter('').print({
      mode: () => 'thing',
      raw: () => ({ items: [{ id: 'x' }] }),
    })
    expect(received).toEqual({ items: [{ id: 'x' }] })
  })
})
