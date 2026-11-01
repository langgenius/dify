import type {
  FormValue,
  ModelParameterRule,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { mergeValidCompletionParams } from './completion-params'

const createRule = (overrides: Partial<ModelParameterRule> = {}): ModelParameterRule => ({
  name: 'value',
  type: 'int',
  label: { en_US: 'Value', zh_Hans: '值' },
  required: false,
  ...overrides,
})

describe('mergeValidCompletionParams', () => {
  it.each([undefined, {}])('accepts an empty parameter set: %j', (params) => {
    expect(mergeValidCompletionParams(params, [])).toEqual({ params: {}, removedDetails: {} })
  })

  it.each([
    { type: 'int', value: 0, min: 0, max: 2 },
    { type: 'int', value: 2, min: 0, max: 2 },
    { type: 'int', value: 999999 },
    { type: 'float', value: 0.7, min: 0, max: 2 },
    { type: 'boolean', value: false },
    { type: 'boolean', value: true },
    { type: 'string', value: '' },
    { type: 'text', value: 'Hello world' },
    { type: 'string', value: 'gpt-4', options: ['gpt-4'] },
    { type: 'text', value: 'unrestricted', options: [] },
  ])('preserves $type value $value', ({ value, ...rule }) => {
    expect(mergeValidCompletionParams({ value }, [createRule(rule)])).toEqual({
      params: { value },
      removedDetails: {},
    })
  })

  it.each([
    { type: 'int', value: '100' },
    { type: 'int', value: 1.5 },
    { type: 'int', value: Number.NaN },
    { type: 'float', value: Number.NaN },
    { type: 'float', value: Number.POSITIVE_INFINITY },
    { type: 'float', value: Number.NEGATIVE_INFINITY },
    { type: 'boolean', value: 'yes' },
    { type: 'string', value: 1 },
    { type: 'text', value: ['text'] },
  ])('rejects invalid $type value $value even without range constraints', ({ type, value }) => {
    expect(mergeValidCompletionParams({ value }, [createRule({ type })])).toEqual({
      params: {},
      removedDetails: { value: 'invalid type' },
    })
  })

  it.each([-1, 3])('reports the allowed range for %s', (value) => {
    expect(mergeValidCompletionParams({ value }, [createRule({ min: 0, max: 2 })])).toEqual({
      params: {},
      removedDetails: { value: 'out of range (0-2)' },
    })
  })

  it.each(['string', 'text'])('rejects an unavailable %s option', (type) => {
    expect(
      mergeValidCompletionParams({ value: 'invalid' }, [createRule({ type, options: ['gpt-4'] })]),
    ).toEqual({
      params: {},
      removedDetails: { value: 'unsupported option' },
    })
  })

  it.each([true, false])('keeps unlisted stop sequences only in advanced mode (%s)', (advanced) => {
    expect(mergeValidCompletionParams({ stop: ['END'] }, [], advanced)).toEqual(
      advanced
        ? { params: { stop: ['END'] }, removedDetails: {} }
        : { params: {}, removedDetails: { stop: 'unsupported' } },
    )
  })

  it('keeps valid parameters while explaining each discarded parameter', () => {
    const params: FormValue = {
      temperature: 0.7,
      max_tokens: 5000,
      model: 'gpt-4',
      unsupported: 'value',
    }
    const rules = [
      createRule({ name: 'temperature', type: 'float', min: 0, max: 2 }),
      createRule({ name: 'max_tokens', min: 1, max: 4096 }),
      createRule({ name: 'model', type: 'string', options: ['gpt-4'] }),
    ]
    expect(mergeValidCompletionParams(params, rules)).toEqual({
      params: { temperature: 0.7, model: 'gpt-4' },
      removedDetails: { max_tokens: 'out of range (1-4096)', unsupported: 'unsupported' },
    })
  })

  it('rejects a parameter with an unsupported rule type', () => {
    expect(
      mergeValidCompletionParams({ value: 'custom' }, [createRule({ type: 'unknown_type' })]),
    ).toEqual({
      params: {},
      removedDetails: { value: 'unsupported rule type: unknown_type' },
    })
  })
})

describe('completion-params regressions', () => {
  it('rejects fractional values for int rules', () => {
    const rules: ModelParameterRule[] = [
      {
        name: 'max_tokens',
        type: 'int',
        min: 1,
        max: 100,
        label: { en_US: 'Max Tokens', zh_Hans: '最大 Token 数' },
        required: false,
      },
    ]
    const result = mergeValidCompletionParams({ max_tokens: 1.5 }, rules)
    expect(result.params).toEqual({})
    expect(result.removedDetails.max_tokens).toBeDefined()
  })

  it('rejects non-finite numbers', () => {
    const rules: ModelParameterRule[] = [
      {
        name: 'temperature',
        type: 'float',
        min: 0,
        max: 2,
        label: { en_US: 'Temperature', zh_Hans: '温度' },
        required: false,
      },
    ]
    const result = mergeValidCompletionParams({ temperature: Number.NaN }, rules)
    expect(result.params).toEqual({})
  })
})
