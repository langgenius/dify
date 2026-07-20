import type { FormattedPrintable, NamePrintable, TablePrintable } from './output'
import { describe, expect, it } from 'vitest'
import { OutputFormatNotSupportedError } from './errors'
import { formatted, raw, stringifyOutput, table } from './output'

function makeFormatted(opts: {
  text?: string
  json?: unknown
  name?: string
}): FormattedPrintable & NamePrintable {
  return {
    text: () => opts.text ?? 'hello',
    json: () => opts.json ?? { msg: 'hello' },
    name: () => opts.name ?? 'my-name',
  }
}

function makeTable(opts: {
  columns?: Array<{ name: string; priority: number }>
  rows?: Array<Array<string | number | boolean | null | undefined>>
  json?: unknown
  name?: string
}): TablePrintable & NamePrintable {
  return {
    tableColumns: () =>
      opts.columns ?? [
        { name: 'NAME', priority: 0 },
        { name: 'STATUS', priority: 0 },
      ],
    tableRows: () => opts.rows ?? [['alice', 'active']],
    json: () => opts.json ?? [{ name: 'alice', status: 'active' }],
    name: () => opts.name ?? 'table-name',
  }
}

describe('raw', () => {
  it('creates RawOutput with kind=raw', () => {
    const out = raw('hello\n')
    expect(out.kind).toBe('raw')
    expect(out.data).toBe('hello\n')
  })
})

describe('table', () => {
  it('creates TableOutput with kind=table', () => {
    const data = makeTable({})
    const out = table({ format: 'json', data })
    expect(out.kind).toBe('table')
    expect(out.format).toBe('json')
    expect(out.data).toBe(data)
  })
})

describe('formatted', () => {
  it('creates FormattedOutput with kind=formatted', () => {
    const data = makeFormatted({})
    const out = formatted({ format: 'text', data })
    expect(out.kind).toBe('formatted')
    expect(out.format).toBe('text')
    expect(out.data).toBe(data)
  })
})

describe('stringifyOutput — raw', () => {
  it('returns raw data as-is', () => {
    expect(stringifyOutput(raw('abc\n'))).toBe('abc\n')
  })
})

describe('stringifyOutput — formatted', () => {
  it('text: calls data.text()', () => {
    const out = formatted({ format: 'text', data: makeFormatted({ text: 'plain text\n' }) })
    expect(stringifyOutput(out)).toBe('plain text\n')
  })

  it('empty format: calls data.text()', () => {
    const out = formatted({ format: '', data: makeFormatted({ text: 'default\n' }) })
    expect(stringifyOutput(out)).toBe('default\n')
  })

  it('json: serializes data.json() with 2-space indent + newline', () => {
    const out = formatted({ format: 'json', data: makeFormatted({ json: { x: 1 } }) })
    expect(stringifyOutput(out)).toBe(`${JSON.stringify({ x: 1 }, null, 2)}\n`)
  })

  it('yaml: renders YAML of data.json()', () => {
    const out = formatted({ format: 'yaml', data: makeFormatted({ json: { x: 1 } }) })
    const result = stringifyOutput(out)
    expect(result).toContain('x: 1')
  })

  it('name: returns data.name() + newline', () => {
    const out = formatted({ format: 'name', data: makeFormatted({ name: 'my-app' }) })
    expect(stringifyOutput(out)).toBe('my-app\n')
  })

  it('name: throws when data has no name()', () => {
    const noName: FormattedPrintable = {
      text: () => 'txt',
      json: () => ({}),
    }
    const out = formatted({ format: 'name', data: noName })
    expect(() => stringifyOutput(out)).toThrow(OutputFormatNotSupportedError)
  })

  it('unknown format: throws with allowed list', () => {
    const out = formatted({ format: 'csv', data: makeFormatted({}) })
    expect(() => stringifyOutput(out)).toThrow(OutputFormatNotSupportedError)
  })
})

describe('stringifyOutput — table', () => {
  it('default format: renders tabular text with header row', () => {
    const out = table({ format: '', data: makeTable({}) })
    const result = stringifyOutput(out)
    expect(result).toContain('NAME')
    expect(result).toContain('STATUS')
    expect(result).toContain('alice')
    expect(result).toContain('active')
  })

  it('wide: includes all columns', () => {
    const data = makeTable({
      columns: [
        { name: 'NAME', priority: 0 },
        { name: 'EXTRA', priority: 1 },
      ],
      rows: [['bob', 'hidden']],
    })
    const wide = table({ format: 'wide', data })
    const narrow = table({ format: '', data })
    expect(stringifyOutput(wide)).toContain('EXTRA')
    expect(stringifyOutput(narrow)).not.toContain('EXTRA')
  })

  it('aligns columns correctly when cells contain CJK double-width characters', () => {
    const data = makeTable({
      columns: [
        { name: 'NAME', priority: 0 },
        { name: 'ID', priority: 0 },
      ],
      rows: [
        ['hello', 'aaa'],
        ['猜谜', 'bbb'], // 猜谜 = 2 CJK chars, display width 4
      ],
    })
    const result = stringifyOutput(table({ format: '', data }))
    const lines = result.split('\n').filter((l) => l.length > 0)
    // 'hello' display width 5, '猜谜' display width 4 — column width=5
    // padding after 'hello': 5-5+2=2 spaces → 'hello  aaa'
    // padding after '猜谜':  5-4+2=3 spaces → '猜谜   bbb'
    expect(lines[1]).toBe('hello  aaa')
    expect(lines[2]).toBe('猜谜   bbb')
  })

  it('json: serializes data.json() + newline', () => {
    const out = table({ format: 'json', data: makeTable({ json: [{ id: 1 }] }) })
    expect(stringifyOutput(out)).toBe(`${JSON.stringify([{ id: 1 }], null, 2)}\n`)
  })

  it('yaml: renders YAML of data.json()', () => {
    const out = table({ format: 'yaml', data: makeTable({ json: [{ id: 1 }] }) })
    expect(stringifyOutput(out)).toContain('id: 1')
  })

  it('name: returns data.name() + newline', () => {
    const out = table({ format: 'name', data: makeTable({ name: 'row-name' }) })
    expect(stringifyOutput(out)).toBe('row-name\n')
  })

  it('name: throws when data has no name()', () => {
    const noName: TablePrintable = {
      tableColumns: () => [],
      tableRows: () => [],
      json: () => [],
    }
    const out = table({ format: 'name', data: noName })
    expect(() => stringifyOutput(out)).toThrow(OutputFormatNotSupportedError)
  })

  it('unknown format: throws with allowed list', () => {
    const out = table({ format: 'csv', data: makeTable({}) })
    expect(() => stringifyOutput(out)).toThrow(OutputFormatNotSupportedError)
  })

  it('table renders column padding correctly', () => {
    const data = makeTable({
      columns: [
        { name: 'NAME', priority: 0 },
        { name: 'ID', priority: 0 },
      ],
      rows: [
        ['alice-longname', '1'],
        ['bob', '2'],
      ],
    })
    const result = stringifyOutput(table({ format: '', data }))
    const lines = result.split('\n').filter(Boolean)
    expect(lines).toHaveLength(3)
    const headerParts = lines[0]!.split(/\s{2,}/)
    expect(headerParts[0]).toBe('NAME')
    expect(headerParts[1]).toBe('ID')
  })

  it('empty columns produces only a newline', () => {
    const data = makeTable({ columns: [], rows: [] })
    expect(stringifyOutput(table({ format: '', data }))).toBe('\n')
  })
})
