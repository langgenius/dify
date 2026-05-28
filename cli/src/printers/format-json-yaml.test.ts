import { describe, expect, it } from 'vitest'
import { JsonYamlPrintFlags } from './format-json-yaml.js'
import { isNoCompatiblePrinter } from './printer.js'

describe('JsonYamlPrintFlags.allowedFormats', () => {
  it('returns json + yaml', () => {
    expect(new JsonYamlPrintFlags().allowedFormats()).toEqual(['json', 'yaml'])
  })
})

describe('JsonYamlPrintFlags.toPrinter', () => {
  it('throws NoCompatiblePrinterError for unsupported formats', () => {
    const pf = new JsonYamlPrintFlags()
    for (const f of ['', 'text', 'wide', 'name', 'xml']) {
      let caught: unknown
      try {
        pf.toPrinter(f)
      }
      catch (e) {
        caught = e
      }
      expect(isNoCompatiblePrinter(caught)).toBe(true)
    }
  })

  it('returns a json printer that encodes raw payload with 2-space indent', () => {
    const p = new JsonYamlPrintFlags().toPrinter('json')
    const out = p.print({ raw: () => ({ answer: 'hi' }) })
    expect(out).toContain('"answer"')
    expect(out).toContain('"hi"')
    expect(out).toContain('  "answer"')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('json printer round-trips a plain object with no Raw()', () => {
    const p = new JsonYamlPrintFlags().toPrinter('json')
    const out = p.print({ k: 'v', n: 1 })
    expect(JSON.parse(out)).toEqual({ k: 'v', n: 1 })
  })

  it('json printer is lossless for nested arrays', () => {
    const data = { items: [{ id: 'a' }, { id: 'b' }] }
    const out = new JsonYamlPrintFlags().toPrinter('json').print(data)
    expect(JSON.parse(out)).toEqual(data)
  })

  it('returns a yaml printer that emits scalar pairs', () => {
    const p = new JsonYamlPrintFlags().toPrinter('yaml')
    const out = p.print({ raw: () => ({ answer: 'hi' }) })
    expect(out).toMatch(/answer:\s*['"]?hi['"]?\n?/)
  })

  it('yaml printer round-trips structured data', async () => {
    const yaml = await import('js-yaml')
    const data = { items: [{ id: 'a', mode: 'chat' }, { id: 'b', mode: 'workflow' }] }
    const out = new JsonYamlPrintFlags().toPrinter('yaml').print(data)
    expect(yaml.load(out)).toEqual(data)
  })
})
