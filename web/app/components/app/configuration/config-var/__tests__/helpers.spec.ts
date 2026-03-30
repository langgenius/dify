import type { InputVar } from '@/app/components/workflow/types'
import type { ExternalDataTool } from '@/models/common'
import type { PromptVariable } from '@/models/debug'
import { describe, expect, it } from 'vitest'
import { InputVarType } from '@/app/components/workflow/types'
import {
  buildPromptVariableFromExternalDataTool,
  buildPromptVariableFromInput,
  createPromptVariablesWithIds,
  getDuplicateError,
  toInputVar,
} from '../helpers'

const createPromptVariable = (overrides: Partial<PromptVariable> = {}): PromptVariable => ({
  key: 'var_1',
  name: 'Variable 1',
  required: false,
  type: 'string',
  ...overrides,
})

const createInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  label: 'Variable 1',
  required: false,
  type: InputVarType.textInput,
  variable: 'var_1',
  ...overrides,
})

const createExternalDataTool = (overrides: Partial<ExternalDataTool> = {}): ExternalDataTool => ({
  config: { region: 'us' },
  enabled: true,
  icon: 'icon',
  icon_background: '#000',
  label: 'External Tool',
  type: 'api',
  variable: 'external_tool',
  ...overrides,
})

describe('config-var/helpers', () => {
  it('should convert prompt variables into input vars', () => {
    expect(toInputVar(createPromptVariable())).toEqual(expect.objectContaining({
      label: 'Variable 1',
      required: false,
      type: InputVarType.textInput,
      variable: 'var_1',
    }))

    expect(toInputVar(createPromptVariable({
      required: undefined,
      type: 'select',
    }))).toEqual(expect.objectContaining({
      required: false,
      type: 'select',
    }))
  })

  it('should build prompt variables from input vars', () => {
    expect(buildPromptVariableFromInput(createInputVar())).toEqual(expect.objectContaining({
      key: 'var_1',
      name: 'Variable 1',
      type: 'string',
    }))

    expect(buildPromptVariableFromInput(createInputVar({
      options: ['One'],
      type: InputVarType.select,
    }))).toEqual(expect.objectContaining({
      options: ['One'],
      type: InputVarType.select,
    }))

    expect(buildPromptVariableFromInput(createInputVar({
      options: ['One'],
      type: InputVarType.number,
    }))).not.toHaveProperty('options')
  })

  it('should detect duplicate keys and labels', () => {
    expect(getDuplicateError([
      createPromptVariable({ key: 'same', name: 'First' }),
      createPromptVariable({ key: 'same', name: 'Second' }),
    ])).toEqual({
      errorMsgKey: 'varKeyError.keyAlreadyExists',
      typeName: 'variableConfig.varName',
    })

    expect(getDuplicateError([
      createPromptVariable({ key: 'first', name: 'Same' }),
      createPromptVariable({ key: 'second', name: 'Same' }),
    ])).toEqual({
      errorMsgKey: 'varKeyError.keyAlreadyExists',
      typeName: 'variableConfig.labelName',
    })

    expect(getDuplicateError([
      createPromptVariable({ key: 'first', name: 'First' }),
      createPromptVariable({ key: 'second', name: 'Second' }),
    ])).toBeNull()
  })

  it('should build prompt variables from external data tools and assign ids', () => {
    const tool = createExternalDataTool()
    expect(buildPromptVariableFromExternalDataTool(tool, true)).toEqual(expect.objectContaining({
      config: { region: 'us' },
      enabled: true,
      key: 'external_tool',
      name: 'External Tool',
      required: true,
      type: 'api',
    }))

    expect(createPromptVariablesWithIds([
      createPromptVariable({ key: 'first' }),
      createPromptVariable({ key: 'second' }),
    ])).toEqual([
      { id: 'first', variable: expect.objectContaining({ key: 'first' }) },
      { id: 'second', variable: expect.objectContaining({ key: 'second' }) },
    ])
  })
})
