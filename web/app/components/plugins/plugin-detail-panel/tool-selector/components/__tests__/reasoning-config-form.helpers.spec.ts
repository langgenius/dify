import { describe, expect, it } from 'vitest'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { VarType } from '@/app/components/workflow/types'
import {
  createEmptyAppValue,
  createFilterVar,
  createPickerProps,
  createReasoningFormContext,
  getFieldFlags,
  getFieldTitle,
  getVarKindType,
  getVisibleSelectOptions,
  mergeReasoningValue,
  resolveTargetVarType,
  updateInputAutoState,
  updateReasoningValue,
  updateVariableSelectorValue,
  updateVariableTypeValue,
} from '../reasoning-config-form.helpers'

describe('reasoning-config-form helpers', () => {
  it('maps schema types to variable-kind types and target variable types', () => {
    expect(getVarKindType(FormTypeEnum.files)).toBe(VarKindType.variable)
    expect(getVarKindType(FormTypeEnum.textNumber)).toBe(VarKindType.constant)
    expect(getVarKindType(FormTypeEnum.textInput)).toBe(VarKindType.mixed)
    expect(getVarKindType(FormTypeEnum.dynamicSelect)).toBeUndefined()

    expect(resolveTargetVarType(FormTypeEnum.textInput)).toBe(VarType.string)
    expect(resolveTargetVarType(FormTypeEnum.textNumber)).toBe(VarType.number)
    expect(resolveTargetVarType(FormTypeEnum.files)).toBe(VarType.arrayFile)
    expect(resolveTargetVarType(FormTypeEnum.file)).toBe(VarType.file)
    expect(resolveTargetVarType(FormTypeEnum.checkbox)).toBe(VarType.boolean)
    expect(resolveTargetVarType(FormTypeEnum.object)).toBe(VarType.object)
    expect(resolveTargetVarType(FormTypeEnum.array)).toBe(VarType.arrayObject)
  })

  it('creates variable filters for supported field types', () => {
    const numberFilter = createFilterVar(FormTypeEnum.textNumber)
    const stringFilter = createFilterVar(FormTypeEnum.textInput)
    const fileFilter = createFilterVar(FormTypeEnum.files)

    expect(numberFilter?.({ type: VarType.number } as never)).toBe(true)
    expect(numberFilter?.({ type: VarType.string } as never)).toBe(false)
    expect(stringFilter?.({ type: VarType.secret } as never)).toBe(true)
    expect(fileFilter?.({ type: VarType.arrayFile } as never)).toBe(true)
  })

  it('filters select options based on show_on conditions', () => {
    const options = [
      {
        value: 'one',
        label: { en_US: 'One', zh_Hans: 'One' },
        show_on: [],
      },
      {
        value: 'two',
        label: { en_US: 'Two', zh_Hans: 'Two' },
        show_on: [{ variable: 'mode', value: 'advanced' }],
      },
    ]

    expect(getVisibleSelectOptions(options as never, {
      mode: { value: { value: 'advanced' } },
    }, 'en_US')).toEqual([
      { value: 'one', name: 'One' },
      { value: 'two', name: 'Two' },
    ])

    expect(getVisibleSelectOptions(options as never, {
      mode: { value: { value: 'basic' } },
    }, 'en_US')).toEqual([
      { value: 'one', name: 'One' },
    ])
  })

  it('updates reasoning values for auto, constant, variable, and merged states', () => {
    const value = {
      prompt: {
        value: {
          type: VarKindType.constant,
          value: 'hello',
        },
        auto: 0 as const,
      },
    }

    expect(updateInputAutoState(value, 'prompt', true, FormTypeEnum.textInput)).toEqual({
      prompt: {
        value: null,
        auto: 1,
      },
    })

    expect(updateVariableTypeValue(value, 'prompt', VarKindType.variable, '')).toEqual({
      prompt: {
        value: {
          type: VarKindType.variable,
          value: '',
        },
        auto: 0,
      },
    })

    expect(updateReasoningValue(value, 'prompt', FormTypeEnum.textInput, 'updated')).toEqual({
      prompt: {
        value: {
          type: VarKindType.mixed,
          value: 'updated',
        },
        auto: 0,
      },
    })

    expect(mergeReasoningValue(value, 'prompt', { extra: true })).toEqual({
      prompt: {
        value: {
          type: VarKindType.constant,
          value: 'hello',
          extra: true,
        },
        auto: 0,
      },
    })

    expect(updateVariableSelectorValue(value, 'prompt', ['node', 'field'])).toEqual({
      prompt: {
        value: {
          type: VarKindType.variable,
          value: ['node', 'field'],
        },
        auto: 0,
      },
    })
  })

  it('derives field flags and picker props from schema types', () => {
    expect(getFieldFlags(FormTypeEnum.object, { type: VarKindType.constant })).toEqual(expect.objectContaining({
      isObject: true,
      isShowJSONEditor: true,
      showTypeSwitch: true,
      isConstant: true,
    }))

    expect(createPickerProps({
      type: FormTypeEnum.select,
      value: {},
      language: 'en_US',
      schema: {
        options: [
          {
            value: 'one',
            label: { en_US: 'One', zh_Hans: 'One' },
            show_on: [],
          },
        ],
      } as never,
    })).toEqual(expect.objectContaining({
      targetVarType: VarType.string,
      selectItems: [{ value: 'one', name: 'One' }],
    }))
  })

  it('provides label helpers and empty defaults', () => {
    expect(getFieldTitle({ en_US: 'Prompt', zh_Hans: 'Prompt' }, 'en_US')).toBe('Prompt')
    expect(createEmptyAppValue()).toEqual({
      app_id: '',
      inputs: {},
      files: [],
    })
    expect(createReasoningFormContext({
      availableNodes: [{ id: 'node-1' }] as never,
      nodeId: 'node-current',
      nodeOutputVars: [{ nodeId: 'node-1' }] as never,
    })).toEqual({
      availableNodes: [{ id: 'node-1' }],
      nodeId: 'node-current',
      nodeOutputVars: [{ nodeId: 'node-1' }],
    })
  })
})
