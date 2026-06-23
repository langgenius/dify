import type { OutputDraft } from '../utils'
import { describe, expect, it } from 'vitest'
import {
  createOutputFromDraft,
  getDefaultValueErrorKey,
} from '../utils'

const createDraft = (overrides: Partial<OutputDraft> = {}): OutputDraft => ({
  children: [],
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

  it('should preserve object children when building an output', () => {
    expect(createOutputFromDraft(createDraft({
      children: [{
        name: 'email',
        type: 'string',
        required: true,
        description: 'User email',
      }],
      name: 'profile',
      type: 'object',
    }))).toMatchObject({
      name: 'profile',
      type: 'object',
      children: [{
        name: 'email',
        type: 'string',
        required: true,
        description: 'User email',
      }],
    })
  })

  it('should preserve array object item children when building an output', () => {
    expect(createOutputFromDraft(createDraft({
      children: [{
        name: 'city',
        type: 'string',
        required: false,
      }],
      name: 'addresses',
      type: 'array[object]',
    }))).toMatchObject({
      name: 'addresses',
      type: 'array',
      array_item: {
        type: 'object',
        children: [{
          name: 'city',
          type: 'string',
          required: false,
        }],
      },
    })
  })
})
