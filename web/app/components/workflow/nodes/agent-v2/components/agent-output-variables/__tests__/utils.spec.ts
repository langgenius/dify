import type { OutputDraft } from '../utils'
import { describe, expect, it } from 'vitest'
import {
  createOutputFromDraft,
  getDefaultValueErrorKey,
} from '../utils'

const createDraft = (overrides: Partial<OutputDraft> = {}): OutputDraft => ({
  defaultValue: '',
  description: '',
  name: 'summary',
  required: false,
  type: 'string',
  ...overrides,
})

describe('agent output variables utils', () => {
  it('should build a declared output from the editable draft', () => {
    expect(createOutputFromDraft(createDraft({
      defaultValue: '42',
      description: 'A numeric score',
      required: true,
      type: 'number',
    }))).toEqual({
      name: 'summary',
      type: 'number',
      required: true,
      description: 'A numeric score',
      failure_strategy: {
        on_failure: 'default_value',
        default_value: 42,
      },
    })
  })

  it('should validate default values against the declared output type', () => {
    expect(getDefaultValueErrorKey(createDraft({
      defaultValue: 'not-json',
      type: 'object',
    }))).toBe('nodes.agent.outputVars.defaultValueObjectInvalid')

    expect(getDefaultValueErrorKey(createDraft({
      defaultValue: '{}',
      type: 'array[string]',
    }))).toBe('nodes.agent.outputVars.defaultValueArrayInvalid')

    expect(getDefaultValueErrorKey(createDraft({
      defaultValue: 'yes',
      type: 'boolean',
    }))).toBe('nodes.agent.outputVars.defaultValueBooleanInvalid')

    expect(getDefaultValueErrorKey(createDraft({
      defaultValue: '[]',
      type: 'array[file]',
    }))).toBe('nodes.agent.outputVars.defaultValueFileUnsupported')
  })
})
