import type { AnyFormApi } from '@tanstack/react-form'
import { renderHook } from '@testing-library/react'
import { FormTypeEnum } from '../../types'
import { useGetFormValues } from '../use-get-form-values'

const mockCheckValidated = vi.fn()
const mockTransform = vi.fn()

vi.mock('../use-check-validated', () => ({
  useCheckValidated: () => ({
    checkValidated: mockCheckValidated,
  }),
}))

vi.mock('../../utils/secret-input', () => ({
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

  it('should return raw values when validation passes but no transformation is requested', () => {
    const form = {
      store: { state: { values: { email: 'test@example.com' } } },
    }
    const schemas = [{
      name: 'email',
      label: 'Email',
      required: true,
      type: FormTypeEnum.textInput,
    }]
    mockCheckValidated.mockReturnValue(true)

    const { result } = renderHook(() => useGetFormValues(form as unknown as AnyFormApi, schemas))

    expect(result.current.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: false,
    })).toEqual({
      values: { email: 'test@example.com' },
      isCheckValidated: true,
    })
    expect(mockTransform).not.toHaveBeenCalled()
  })

  it('should return raw values when validation passes and transformation is undefined', () => {
    const form = {
      store: { state: { values: { username: 'john_doe' } } },
    }
    const schemas = [{
      name: 'username',
      label: 'Username',
      required: true,
      type: FormTypeEnum.textInput,
    }]
    mockCheckValidated.mockReturnValue(true)

    const { result } = renderHook(() => useGetFormValues(form as unknown as AnyFormApi, schemas))

    expect(result.current.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: undefined,
    })).toEqual({
      values: { username: 'john_doe' },
      isCheckValidated: true,
    })
    expect(mockTransform).not.toHaveBeenCalled()
  })

  it('should handle empty form values when validation check is disabled', () => {
    const form = {
      store: { state: { values: {} } },
    }

    const { result } = renderHook(() => useGetFormValues(form as unknown as AnyFormApi, []))

    expect(result.current.getFormValues({ needCheckValidatedValues: false })).toEqual({
      values: {},
      isCheckValidated: true,
    })
    expect(mockCheckValidated).not.toHaveBeenCalled()
  })

  it('should handle null form values gracefully', () => {
    const form = {
      store: { state: { values: null } },
    }

    const { result } = renderHook(() => useGetFormValues(form as unknown as AnyFormApi, []))

    expect(result.current.getFormValues({ needCheckValidatedValues: false })).toEqual({
      values: {},
      isCheckValidated: true,
    })
  })

  it('should call transform with correct arguments when transformation is requested', () => {
    const form = {
      store: { state: { values: { password: 'secret' } } },
    }
    const schemas = [{
      name: 'password',
      label: 'Password',
      required: true,
      type: FormTypeEnum.secretInput,
    }]
    mockCheckValidated.mockReturnValue(true)
    mockTransform.mockReturnValue({ password: 'encrypted' })

    const { result } = renderHook(() => useGetFormValues(form as unknown as AnyFormApi, schemas))

    result.current.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: true,
    })

    expect(mockTransform).toHaveBeenCalledWith(schemas, form)
  })

  it('should return validation failure before attempting transformation', () => {
    const form = {
      store: { state: { values: { password: 'secret' } } },
    }
    const schemas = [{
      name: 'password',
      label: 'Password',
      required: true,
      type: FormTypeEnum.secretInput,
    }]
    mockCheckValidated.mockReturnValue(false)

    const { result } = renderHook(() => useGetFormValues(form as unknown as AnyFormApi, schemas))

    expect(result.current.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: true,
    })).toEqual({
      values: {},
      isCheckValidated: false,
    })
    expect(mockTransform).not.toHaveBeenCalled()
  })

  it('should handle complex nested values with validation check disabled', () => {
    const form = {
      store: {
        state: {
          values: {
            user: { name: 'Alice', age: 30 },
            settings: { theme: 'dark' },
          },
        },
      },
    }

    const { result } = renderHook(() => useGetFormValues(form as unknown as AnyFormApi, []))

    expect(result.current.getFormValues({ needCheckValidatedValues: false })).toEqual({
      values: {
        user: { name: 'Alice', age: 30 },
        settings: { theme: 'dark' },
      },
      isCheckValidated: true,
    })
  })
})
