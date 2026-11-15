import type { ReasoningConfigValue } from '../reasoning-config-form'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import type { Var } from '@/app/components/workflow/types'
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
  name: 'field',
  variable: 'field',
  label: { en_US: 'Field', zh_Hans: '字段' },
  type: FormTypeEnum.textInput,
  _type: 'string',
  form: 'llm',
  required: false,
  default: '',
  tooltip: { en_US: 'Tooltip', zh_Hans: '提示' },
  show_on: [],
  options: [],
  placeholder: { en_US: 'Placeholder', zh_Hans: '占位符' },
  scope: 'all',
  url: '',
  input_schema: undefined,
  ...overrides,
})

const createVar = (type: Var['type']): Var => ({ variable: 'field', type })

describe('reasoning-config-form helpers', () => {
  it.each([
    {
      type: FormTypeEnum.files,
      kind: VarKindType.variable,
      target: VarType.arrayFile,
    },
    {
      type: FormTypeEnum.textNumber,
      kind: VarKindType.constant,
      target: VarType.number,
    },
    {
      type: FormTypeEnum.textInput,
      kind: VarKindType.mixed,
      target: VarType.string,
    },
    {
      type: FormTypeEnum.date,
      kind: VarKindType.constant,
      target: VarType.string,
    },
    {
      type: FormTypeEnum.dateRange,
      kind: VarKindType.constant,
      target: VarType.string,
    },
    {
      type: FormTypeEnum.dynamicSelect,
      kind: undefined,
      target: VarType.string,
    },
  ])('maps $type fields to their input and target variable contracts', ({ type, kind, target }) => {
    expect(getVarKindType(type)).toBe(kind)
    expect(resolveTargetVarType(type)).toBe(target)
  })

  it.each([
    [FormTypeEnum.file, VarType.file],
    [FormTypeEnum.checkbox, VarType.boolean],
    [FormTypeEnum.object, VarType.object],
    [FormTypeEnum.array, VarType.arrayObject],
  ])('resolves %s fields to %s variables', (type, target) => {
    expect(resolveTargetVarType(type)).toBe(target)
  })

  it('filters variables according to the field type', () => {
    const numberFilter = createFilterVar(FormTypeEnum.textNumber)!
    const stringFilter = createFilterVar(FormTypeEnum.textInput)!
    const fileFilter = createFilterVar(FormTypeEnum.files)!

    expect(numberFilter(createVar(VarType.number))).toBe(true)
    expect(numberFilter(createVar(VarType.string))).toBe(false)
    expect(stringFilter(createVar(VarType.secret))).toBe(true)
    expect(fileFilter(createVar(VarType.arrayFile))).toBe(true)
    expect(fileFilter(createVar(VarType.string))).toBe(false)
  })

  it('applies date-specific picker filtering without filtering date ranges', () => {
    const dateFilter = createPickerProps({
      type: FormTypeEnum.date,
      value: {},
      language: 'en_US',
      schema: createSchema({ type: FormTypeEnum.date }),
    }).filterVar!

    expect(dateFilter(createVar(VarType.string))).toBe(true)
    expect(dateFilter(createVar(VarType.number))).toBe(true)
    expect(dateFilter(createVar(VarType.file))).toBe(false)
    expect(
      createPickerProps({
        type: FormTypeEnum.dateRange,
        value: {},
        language: 'en_US',
        schema: createSchema({ type: FormTypeEnum.dateRange }),
      }).filterVar,
    ).toBeUndefined()
  })

  it('requires every show_on condition and falls back to the English option label', () => {
    const options: NonNullable<ToolFormSchema['options']> = [
      {
        value: 'always',
        label: { en_US: 'Always', zh_Hans: '始终' },
        show_on: [],
      },
      {
        value: 'qualified',
        label: { en_US: 'Qualified', zh_Hans: '符合条件' },
        show_on: [
          { variable: 'mode', value: 'advanced' },
          { variable: 'tier', value: 'pro' },
        ],
      },
    ]
    const value: ReasoningConfigValue = {
      mode: { value: { value: 'advanced' } },
      tier: { value: { value: 'pro' } },
    }

    expect(getVisibleSelectOptions(options, value, 'de_DE')).toEqual([
      { value: 'always', name: 'Always' },
      { value: 'qualified', name: 'Qualified' },
    ])
    expect(
      getVisibleSelectOptions(options, { ...value, tier: { value: { value: 'basic' } } }, 'de_DE'),
    ).toEqual([{ value: 'always', name: 'Always' }])
  })

  it('transitions a field while preserving unrelated values and the original input', () => {
    const original: ReasoningConfigValue = {
      prompt: {
        value: { type: VarKindType.constant, value: 'hello' },
        auto: 0,
      },
      untouched: {
        value: { type: VarKindType.constant, value: 'keep me', metadata: true },
        auto: 0,
      },
    }
    const snapshot = structuredClone(original)

    const automatic = updateInputAutoState(original, 'prompt', true, FormTypeEnum.textInput)
    expect(automatic.prompt).toEqual({ value: null, auto: 1 })
    expect(automatic.untouched).toEqual(original.untouched)

    const variable = updateVariableTypeValue(
      updateInputAutoState(automatic, 'prompt', false, FormTypeEnum.textInput),
      'prompt',
      VarKindType.variable,
      'ignored default',
    )
    expect(variable.prompt).toEqual({
      value: { type: VarKindType.variable, value: '' },
      auto: 0,
    })

    const edited = updateReasoningValue(variable, 'prompt', FormTypeEnum.textInput, 'updated')
    expect(edited.prompt!.value).toEqual({ type: VarKindType.mixed, value: 'updated' })

    const merged = mergeReasoningValue(edited, 'prompt', { format: 'markdown' })
    expect(merged.prompt!.value).toEqual({
      type: VarKindType.mixed,
      value: 'updated',
      format: 'markdown',
    })

    const selected = updateVariableSelectorValue(merged, 'prompt', ['node', 'field'])
    expect(selected.prompt!.value).toEqual({
      type: VarKindType.variable,
      value: ['node', 'field'],
    })
    expect(selected.untouched).toEqual(original.untouched)
    expect(original).toEqual(snapshot)
  })

  it('derives editor flags and select picker props from typed schemas', () => {
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

    const pickerProps = createPickerProps({
      type: FormTypeEnum.select,
      value: {},
      language: 'en_US',
      schema: createSchema({
        type: FormTypeEnum.select,
        options: [
          {
            value: 'one',
            label: { en_US: 'One', zh_Hans: '一' },
            show_on: [],
          },
        ],
      }),
    })
    expect(pickerProps).toEqual(
      expect.objectContaining({
        targetVarType: VarType.string,
        selectItems: [{ value: 'one', name: 'One' }],
      }),
    )
  })

  it('uses the requested field-title language and falls back to English', () => {
    const labels = { en_US: 'Prompt', zh_Hans: '提示词' }
    expect(getFieldTitle(labels, 'zh_Hans')).toBe('提示词')
    expect(getFieldTitle(labels, 'de_DE')).toBe('Prompt')
  })
})
