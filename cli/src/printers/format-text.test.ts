import { describe, expect, it } from 'vitest'
import { TextPrintFlags } from './format-text.js'

describe('TextPrintFlags', () => {
  it('routes to handler by mode', () => {
    const f = new TextPrintFlags()
    f.register({ render: v => `chat:${(v as { x: string }).x}\n` }, 'chat')
    f.register({ render: v => `wf:${(v as { y: string }).y}\n` }, 'workflow')
    expect(f.toPrinter('').print({ mode: () => 'chat', raw: () => ({ x: '1' }) })).toBe('chat:1\n')
    expect(f.toPrinter('text').print({ mode: () => 'workflow', raw: () => ({ y: '2' }) })).toBe('wf:2\n')
  })

  it('rejects unknown formats', () => {
    expect(() => new TextPrintFlags().toPrinter('json')).toThrow(/not supported/)
  })

  it('errors on unregistered mode', () => {
    const f = new TextPrintFlags()
    expect(() => f.toPrinter('').print({ mode: () => 'agent', raw: () => ({}) })).toThrow(/no handler for mode/)
  })
})
