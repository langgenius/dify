import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import { describe, expect, it } from 'vite-plus/test'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { VarType } from '@/app/components/workflow/types'
import {
  createFilterVar,
  createPickerProps,
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

const createSchema = (overrides: Partial<ToolFormSchema> = {}): ToolFormSchema => ({
  name: 'input',
  variable: 'input',
  label: { en_US: 'Input', zh_Hans: '输入' },
  type: FormTypeEnum.textInput,
  _type: 'string',
  form: 'llm',
  required: false,
  show_on: [],
  ...overrides,
})

describe('reasoning-config-form helpers', () => {
  it('maps schema types to variable-kind types and target variable types', () => {
    expect(getVarKindType(FormTypeEnum.files)).toBe(VarKindType.variable)
    expect(getVarKindType(FormTypeEnum.textNumber)).toBe(VarKindType.constant)
    expect(getVarKindType(FormTypeEnum.textInput)).toBe(VarKindType.mixed)
    expect(getVarKindType(FormTypeEnum.date)).toBe(VarKindType.constant)
    expect(getVarKindType(FormTypeEnum.dateRange)).toBe(VarKindType.constant)
    expect(getVarKindType(FormTypeEnum.dynamicSelect)).toBeUndefined()

    expect(resolveTargetVarType(FormTypeEnum.textInput)).toBe(VarType.string)
    expect(resolveTargetVarType(FormTypeEnum.textNumber)).toBe(VarType.number)
    expect(resolveTargetVarType(FormTypeEnum.date)).toBe(VarType.string)
    expect(resolveTargetVarType(FormTypeEnum.dateRange)).toBe(VarType.string)
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

    expect(numberFilter?.({ variable: 'value', type: VarType.number })).toBe(true)
    expect(numberFilter?.({ variable: 'value', type: VarType.string })).toBe(false)
    expect(stringFilter?.({ variable: 'value', type: VarType.secret })).toBe(true)
    expect(fileFilter?.({ variable: 'value', type: VarType.arrayFile })).toBe(true)
  })

  it('creates variable filters for date fields', () => {
    const dateFilter = createPickerProps({
      type: FormTypeEnum.date,
      value: {},
      language: 'en_US',
      schema: createSchema({ type: FormTypeEnum.date }),
    }).filterVar
    expect(dateFilter?.({ variable: 'value', type: VarType.string })).toBe(true)
    expect(dateFilter?.({ variable: 'value', type: VarType.number })).toBe(true)
    expect(dateFilter?.({ variable: 'value', type: VarType.file })).toBe(false)
    expect(
      createPickerProps({
        type: FormTypeEnum.dateRange,
        value: {},
        language: 'en_US',
        schema: createSchema({ type: FormTypeEnum.dateRange }),
      }).filterVar,
    ).toBeUndefined()
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

    expect(
      getVisibleSelectOptions(
        options,
        {
          mode: { value: { value: 'advanced' } },
        },
        'en_US',
      ),
    ).toEqual([
      { value: 'one', name: 'One' },
      { value: 'two', name: 'Two' },
    ])

    expect(
      getVisibleSelectOptions(
        options,
        {
          mode: { value: { value: 'basic' } },
        },
        'en_US',
      ),
    ).toEqual([{ value: 'one', name: 'One' }])
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
    expect(getFieldFlags(FormTypeEnum.object, { type: VarKindType.constant })).toEqual(
      expect.objectContaining({
        isObject: true,
        isShowJSONEditor: true,
        showTypeSwitch: true,
        isConstant: true,
      }),
    )

    expect(getFieldFlags(FormTypeEnum.date)).toEqual(
      expect.objectContaining({
        isDate: true,
        isDateRange: false,
        isString: false,
        showTypeSwitch: true,
      }),
    )
    expect(getFieldFlags(FormTypeEnum.dateRange)).toEqual(
      expect.objectContaining({
        isDate: false,
        isDateRange: true,
        isString: false,
        showTypeSwitch: false,
      }),
    )

    expect(
      createPickerProps({
        type: FormTypeEnum.select,
        value: {},
        language: 'en_US',
        schema: createSchema({
          options: [
            {
              value: 'one',
              label: { en_US: 'One', zh_Hans: 'One' },
              show_on: [],
            },
          ],
        }),
      }),
    ).toEqual(
      expect.objectContaining({
        targetVarType: VarType.string,
        selectItems: [{ value: 'one', name: 'One' }],
      }),
    )
  })

  it('uses the selected language and falls back to English for missing translations', () => {
    const labels = { en_US: 'Prompt', zh_Hans: '提示词' }
    expect(getFieldTitle(labels, 'zh_Hans')).toBe('提示词')
    expect(getFieldTitle(labels, 'de_DE')).toBe('Prompt')
  })
})
