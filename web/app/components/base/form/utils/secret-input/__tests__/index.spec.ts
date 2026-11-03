import { FieldApi, FormApi } from '@tanstack/react-form'
import { FormTypeEnum } from '../../../types'
import {
  getTransformedValuesWhenSecretInputPristine,
  transformFormSchemasSecretInput,
} from '../index'

describe('secret input utilities', () => {
  it('masks selected secrets without changing other values or the source object', () => {
    const values = { apiKey: 'secret', token: 'token-value', empty: '', zero: 0, absent: null }
    expect(
      transformFormSchemasSecretInput(['apiKey', 'empty', 'zero', 'absent', 'missing'], values),
    ).toEqual({ ...values, apiKey: '[__HIDDEN__]' })
    expect(values.apiKey).toBe('secret')
  })

  it('masks an untouched secret but submits its replacement after editing', () => {
    const form = new FormApi({
      onSubmitMeta: {},
      defaultValues: { apiKey: 'secret', name: 'Alice' },
    })
    const unmountForm = form.mount()
    const field = new FieldApi({ form, name: 'apiKey' })
    const unmountField = field.mount()
    const schemas = [
      { name: 'apiKey', type: FormTypeEnum.secretInput, label: 'API Key', required: true },
      { name: 'name', type: FormTypeEnum.textInput, label: 'Name', required: true },
    ]
    try {
      expect(getTransformedValuesWhenSecretInputPristine(schemas, form)).toEqual({
        apiKey: '[__HIDDEN__]',
        name: 'Alice',
      })
      form.setFieldValue('apiKey', 'replacement')
      expect(getTransformedValuesWhenSecretInputPristine(schemas, form)).toEqual({
        apiKey: 'replacement',
        name: 'Alice',
      })
    } finally {
      unmountField()
      unmountForm()
    }
  })

  it('preserves a secret whose field has not been registered', () => {
    const form = new FormApi({ onSubmitMeta: {}, defaultValues: { apiKey: 'secret' } })
    const unmount = form.mount()
    try {
      expect(
        getTransformedValuesWhenSecretInputPristine(
          [{ name: 'apiKey', type: FormTypeEnum.secretInput, label: 'API Key', required: true }],
          form,
        ),
      ).toEqual({ apiKey: 'secret' })
    } finally {
      unmount()
    }
  })
})
