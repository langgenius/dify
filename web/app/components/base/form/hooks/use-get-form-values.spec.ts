import type { AnyFormApi } from '@tanstack/react-form'
import { renderHook } from '@testing-library/react'
import { FormTypeEnum } from '../types'
import { useGetFormValues } from './use-get-form-values'

const mockCheckValidated = vi.fn()
const mockTransform = vi.fn()

vi.mock('./use-check-validated', () => ({
  useCheckValidated: () => ({
    checkValidated: mockCheckValidated,
  }),
}))

vi.mock('../utils/secret-input', () => ({
  getTransformedValuesWhenSecretInputPristine: (...args: unknown[]) => mockTransform(...args),
}))

describe('useGetFormValues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return raw values when validation check is disabled', () => {
    const form = {
      store: { state: { values: { name: 'Alice' } } },
    }

    const { result } = renderHook(() => useGetFormValues(form as unknown as AnyFormApi, []))

    expect(result.current.getFormValues({ needCheckValidatedValues: false })).toEqual({
      values: { name: 'Alice' },
      isCheckValidated: true,
    })
  })

  it('should return transformed values when validation passes and transform is requested', () => {
    const form = {
      store: { state: { values: { password: 'abc123' } } },
    }
    const schemas = [{
      name: 'password',
      label: 'Password',
      required: true,
      type: FormTypeEnum.secretInput,
    }]
    mockCheckValidated.mockReturnValue(true)
    mockTransform.mockReturnValue({ password: '[__HIDDEN__]' })

    const { result } = renderHook(() => useGetFormValues(form as unknown as AnyFormApi, schemas))

    expect(result.current.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: true,
    })).toEqual({
      values: { password: '[__HIDDEN__]' },
      isCheckValidated: true,
    })
  })

  it('should return empty values when validation fails', () => {
    const form = {
      store: { state: { values: { name: '' } } },
    }
    mockCheckValidated.mockReturnValue(false)

    const { result } = renderHook(() => useGetFormValues(form as unknown as AnyFormApi, []))

    expect(result.current.getFormValues({ needCheckValidatedValues: true })).toEqual({
      values: {},
      isCheckValidated: false,
    })
  })
})
