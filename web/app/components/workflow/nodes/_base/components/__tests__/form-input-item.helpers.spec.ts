import type { CredentialFormSchema, FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Var } from '@/app/components/workflow/types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType } from '@/app/components/workflow/types'
import { VarKindType } from '../../types'
import {
  filterVisibleOptions,
  getCheckboxListOptions,
  getCheckboxListValue,
  getFilterVar,
  getFormInputState,
  getNumberInputValue,
  getSelectedLabels,
  getTargetVarType,
  getVarKindType,
  hasOptionIcon,
  mapSelectItems,
  normalizeVariableSelectorValue,
} from '../form-input-item.helpers'

const createSchema = (
  overrides: Partial<CredentialFormSchema & {
    _type?: FormTypeEnum
    multiple?: boolean
    options?: FormOption[]
  }> = {},
) => ({
  label: { en_US: 'Field', zh_Hans: '字段' },
  name: 'field',
  required: false,
  show_on: [],
  type: FormTypeEnum.textInput,
  variable: 'field',
  ...overrides,
}) as CredentialFormSchema & {
  _type?: FormTypeEnum
  multiple?: boolean
  options?: FormOption[]
}

const createOption = (
  value: string,
  overrides: Partial<FormOption> = {},
): FormOption => ({
  label: { en_US: value, zh_Hans: value },
  show_on: [],
  value,
  ...overrides,
})

describe('form-input-item helpers', () => {
  it('should derive field state and target var type', () => {
    const numberState = getFormInputState(
      createSchema({ type: FormTypeEnum.textNumber }),
      { type: VarKindType.constant, value: 1 },
    )
    const filesState = getFormInputState(
      createSchema({ type: FormTypeEnum.files }),
      { type: VarKindType.variable, value: ['node', 'files'] },
    )

    expect(numberState.isNumber).toBe(true)
    expect(numberState.showTypeSwitch).toBe(true)
    expect(getTargetVarType(numberState)).toBe(VarType.number)
    expect(filesState.isFile).toBe(true)
    expect(filesState.showVariableSelector).toBe(true)
    expect(getTargetVarType(filesState)).toBe(VarType.arrayFile)
  })

  it('should return filter functions and var kind types by schema mode', () => {
    const stringFilter = getFilterVar(getFormInputState(createSchema(), { type: VarKindType.mixed, value: '' }))
    const booleanState = getFormInputState(
      createSchema({ _type: FormTypeEnum.boolean, type: FormTypeEnum.textInput }),
      { type: VarKindType.constant, value: true },
    )

    expect(stringFilter?.({ type: VarType.secret } as Var)).toBe(true)
    expect(stringFilter?.({ type: VarType.file } as Var)).toBe(false)
    expect(getVarKindType(booleanState)).toBe(VarKindType.constant)
    expect(getFilterVar(booleanState)?.({ type: VarType.boolean } as Var)).toBe(false)

    const fileState = getFormInputState(
      createSchema({ type: FormTypeEnum.file }),
      { type: VarKindType.variable, value: ['node', 'file'] },
    )
    const objectState = getFormInputState(
      createSchema({ type: FormTypeEnum.object }),
      { type: VarKindType.constant, value: '{}' },
    )
    const arrayState = getFormInputState(
      createSchema({ type: FormTypeEnum.array }),
      { type: VarKindType.constant, value: '[]' },
    )
    const dynamicState = getFormInputState(
      createSchema({ type: FormTypeEnum.dynamicSelect }),
      { type: VarKindType.constant, value: 'selected' },
    )

    expect(getFilterVar(fileState)?.({ type: VarType.file } as Var)).toBe(true)
    expect(getFilterVar(objectState)?.({ type: VarType.object } as Var)).toBe(true)
    expect(getFilterVar(arrayState)?.({ type: VarType.arrayString } as Var)).toBe(true)
    expect(getVarKindType(fileState)).toBe(VarKindType.variable)
    expect(getVarKindType(dynamicState)).toBe(VarKindType.constant)
    expect(getVarKindType(getFormInputState(createSchema({ type: FormTypeEnum.appSelector }), undefined))).toBeUndefined()
  })

  it('should filter and map visible options using show_on rules', () => {
    const options = [
      createOption('always'),
      createOption('premium', {
        show_on: [{ variable: 'mode', value: 'pro' }],
      }),
    ]
    const values = {
      mode: {
        type: VarKindType.constant,
        value: 'pro',
      },
    }

    const visibleOptions = filterVisibleOptions(options, values)
    expect(visibleOptions).toHaveLength(2)
    expect(mapSelectItems(visibleOptions, 'en_US')).toEqual([
      { name: 'always', value: 'always' },
      { name: 'premium', value: 'premium' },
    ])
    expect(hasOptionIcon(visibleOptions)).toBe(false)
  })

  it('should compute selected labels and checkbox state from visible options', () => {
    const options = [
      createOption('alpha'),
      createOption('beta'),
      createOption('gamma'),
    ]

    expect(getSelectedLabels(['alpha', 'beta'], options, 'en_US')).toBe('alpha, beta')
    expect(getSelectedLabels(['alpha', 'beta', 'gamma'], options, 'en_US')).toBe('3 selected')
    expect(getCheckboxListOptions(options, 'en_US')).toEqual([
      { label: 'alpha', value: 'alpha' },
      { label: 'beta', value: 'beta' },
      { label: 'gamma', value: 'gamma' },
    ])
    expect(getCheckboxListValue(['alpha', 'missing'], ['beta'], options)).toEqual(['alpha'])
  })

  it('should normalize number and variable selector values', () => {
    expect(getNumberInputValue(Number.NaN)).toBe('')
    expect(getNumberInputValue(2)).toBe(2)
    expect(getNumberInputValue('3')).toBe('3')
    expect(getNumberInputValue(undefined)).toBe('')
    expect(normalizeVariableSelectorValue([])).toEqual([])
    expect(normalizeVariableSelectorValue(['node', 'answer'])).toEqual(['node', 'answer'])
    expect(normalizeVariableSelectorValue('')).toBe('')
  })

  it('should derive remaining target variable types and label states', () => {
    const objectState = getFormInputState(createSchema({ type: FormTypeEnum.object }), undefined)
    const arrayState = getFormInputState(createSchema({ type: FormTypeEnum.array }), undefined)

    expect(getTargetVarType(objectState)).toBe(VarType.object)
    expect(getTargetVarType(arrayState)).toBe(VarType.arrayObject)
    expect(getSelectedLabels(undefined, [], 'en_US')).toBe('')
    expect(getCheckboxListValue('alpha', [], [createOption('alpha')])).toEqual(['alpha'])
  })
})
