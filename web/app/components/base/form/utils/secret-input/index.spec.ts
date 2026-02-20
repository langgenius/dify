import type { AnyFormApi } from '@tanstack/react-form'
import { FormTypeEnum } from '../../types'
import { getTransformedValuesWhenSecretInputPristine, transformFormSchemasSecretInput } from './index'

describe('secret input utilities', () => {
  it('should mask only selected truthy values in transformFormSchemasSecretInput', () => {
    expect(transformFormSchemasSecretInput(['apiKey'], {
      apiKey: 'secret',
      token: 'token-value',
      emptyValue: '',
    })).toEqual({
      apiKey: '[__HIDDEN__]',
      token: 'token-value',
      emptyValue: '',
    })
  })

  it('should mask pristine secret input fields from form state', () => {
    const formSchemas = [
      { name: 'apiKey', type: FormTypeEnum.secretInput, label: 'API Key', required: true },
      { name: 'name', type: FormTypeEnum.textInput, label: 'Name', required: true },
    ]
    const form = {
      store: {
        state: {
          values: {
            apiKey: 'secret',
            name: 'Alice',
          },
        },
      },
      getFieldMeta: (name: string) => ({ isPristine: name === 'apiKey' }),
    }

    expect(getTransformedValuesWhenSecretInputPristine(formSchemas, form as unknown as AnyFormApi)).toEqual({
      apiKey: '[__HIDDEN__]',
      name: 'Alice',
    })
  })

  it('should keep value unchanged when secret input is not pristine', () => {
    const formSchemas = [
      { name: 'apiKey', type: FormTypeEnum.secretInput, label: 'API Key', required: true },
    ]
    const form = {
      store: { state: { values: { apiKey: 'secret' } } },
      getFieldMeta: () => ({ isPristine: false }),
    }

    expect(getTransformedValuesWhenSecretInputPristine(formSchemas, form as unknown as AnyFormApi)).toEqual({
      apiKey: 'secret',
    })
  })
})
