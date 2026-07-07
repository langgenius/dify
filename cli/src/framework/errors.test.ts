import type { FlagDefinition } from './types'
import { describe, expect, it } from 'vitest'
import { OutputFormatNotSupportedError, UnsupportedArgValueError } from './errors'

describe('OutputFormatNotSupportedError', () => {
  it('states the offending format in the message', () => {
    const err = new OutputFormatNotSupportedError('csv')
    expect(err.message).toBe('format csv is not supported by this command')
  })
})

describe('UnsupportedArgValueError', () => {
  it('includes both long and short option labels when a char exists', () => {
    const def: FlagDefinition = { type: 'string', description: 'output', char: 'o', options: ['json', 'yaml'] }
    const err = new UnsupportedArgValueError('output', def, 'csv')
    expect(err.message).toBe('illegal value csv for flag --output / -o')
  })

  it('omits the short option label when the flag has no char', () => {
    const def: FlagDefinition = { type: 'string', description: 'app mode', options: ['chat', 'workflow'] }
    const err = new UnsupportedArgValueError('mode', def, 'chatbot')
    expect(err.message).toBe('illegal value chatbot for flag --mode')
  })

  it('lists supported values in the hint', () => {
    const def: FlagDefinition = { type: 'string', description: 'app mode', options: ['chat', 'workflow'] }
    expect(new UnsupportedArgValueError('mode', def, 'chatbot').hint).toBe('supported value: chat, workflow')
  })

  it('leaves the hint empty when the flag declares no options', () => {
    const def: FlagDefinition = { type: 'string', description: 'app mode' }
    expect(new UnsupportedArgValueError('mode', def, 'chatbot').hint).toBe('')
  })
})
