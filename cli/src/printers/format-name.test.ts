import { describe, expect, it } from 'vitest'
import { NamePrintFlags } from './format-name.js'
import { isNoCompatiblePrinter } from './printer.js'

const fakeMode = (m: string) => ({ mode: () => m })

describe('NamePrintFlags.allowedFormats', () => {
  it('returns ["name"]', () => {
    expect(new NamePrintFlags().allowedFormats()).toEqual(['name'])
  })
})

describe('NamePrintFlags.toPrinter', () => {
  it('throws NoCompatiblePrinterError for non-name formats', () => {
    const pf = new NamePrintFlags()
    let caught: unknown
    try {
      pf.toPrinter('json')
    }
    catch (e) {
      caught = e
    }
    expect(isNoCompatiblePrinter(caught)).toBe(true)
  })

  it('prints id + newline for the registered mode', () => {
    const pf = new NamePrintFlags()
    pf.register({ id: () => 'abc-123' }, 'thing')
    expect(pf.toPrinter('name').print(fakeMode('thing'))).toBe('abc-123\n')
  })

  it('appends operation suffix when set', () => {
    const pf = new NamePrintFlags()
    pf.operation = 'created'
    pf.register({ id: () => 'abc' }, 'thing')
    expect(pf.toPrinter('name').print(fakeMode('thing'))).toBe('abc created\n')
  })

  it('throws when payload mode has no registered handler', () => {
    const pf = new NamePrintFlags()
    pf.register({ id: () => 'abc' }, 'thing')
    const printer = pf.toPrinter('name')
    expect(() => printer.print(fakeMode('other'))).toThrow(/no handler for mode/)
  })

  it('throws when payload does not implement Moder', () => {
    const pf = new NamePrintFlags()
    pf.register({ id: () => 'abc' }, 'thing')
    const printer = pf.toPrinter('name')
    expect(() => printer.print({ no: 'mode' })).toThrow(/does not implement Moder/i)
  })

  it('register accepts multiple keys for the same handler', () => {
    const pf = new NamePrintFlags()
    pf.register({ id: () => 'shared' }, 'a', 'b')
    const printer = pf.toPrinter('name')
    expect(printer.print(fakeMode('a'))).toBe('shared\n')
    expect(printer.print(fakeMode('b'))).toBe('shared\n')
  })

  it('unwraps RawObject before passing payload to handler', () => {
    const pf = new NamePrintFlags()
    let received: unknown
    pf.register({
      id: (p) => {
        received = p
        return 'ok'
      },
    }, 'thing')
    pf.toPrinter('name').print({
      mode: () => 'thing',
      raw: () => ({ id: 'unwrapped' }),
    })
    expect(received).toEqual({ id: 'unwrapped' })
  })
})
