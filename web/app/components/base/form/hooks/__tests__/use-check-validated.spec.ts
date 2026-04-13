import type { AnyFormApi } from '@tanstack/react-form'
import { renderHook } from '@testing-library/react'
import { FormTypeEnum } from '../../types'
import { useCheckValidated } from '../use-check-validated'

const mockNotify = vi.fn()

vi.mock('@/app/components/base/ui/toast', () => ({
  default: {
    notify: (args: unknown) => mockNotify(args),
  },
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

describe('useCheckValidated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return true when form has no errors', () => {
    const form = {
      getAllErrors: () => undefined,
      state: { values: {} },
    }

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, []))

    expect(result.current.checkValidated()).toBe(true)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it.each([
    { fieldName: 'name', label: 'Name', message: 'Name is required' },
    { fieldName: 'field1', label: 'Field 1', message: 'Field is required' },
  ])('should notify and return false when visible field has errors (show_on: []) for $fieldName', ({ fieldName, label, message }) => {
    const form = {
      getAllErrors: () => ({
        fields: {
          [fieldName]: { errors: [message] },
        },
      }),
      state: { values: {} },
    }
    const schemas = [{
      name: fieldName,
      label,
      required: true,
      type: FormTypeEnum.textInput,
      show_on: [],
    }]

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, schemas))

    expect(result.current.checkValidated()).toBe(false)
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message,
    })
  })

  it('should ignore hidden field errors and return true', () => {
    const form = {
      getAllErrors: () => ({
        fields: {
          secret: { errors: ['Secret is required'] },
        },
      }),
      state: { values: { enabled: 'false' } },
    }
    const schemas = [{
      name: 'secret',
      label: 'Secret',
      required: true,
      type: FormTypeEnum.textInput,
      show_on: [{ variable: 'enabled', value: 'true' }],
    }]

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, schemas))

    expect(result.current.checkValidated()).toBe(true)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('should notify when field is shown and has errors', () => {
    const form = {
      getAllErrors: () => ({
        fields: {
          secret: { errors: ['Secret is required'] },
        },
      }),
      state: { values: { enabled: 'true' } },
    }
    const schemas = [{
      name: 'secret',
      label: 'Secret',
      required: true,
      type: FormTypeEnum.textInput,
      show_on: [{ variable: 'enabled', value: 'true' }],
    }]

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, schemas))

    expect(result.current.checkValidated()).toBe(false)
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'Secret is required',
    })
  })

  it('should notify with first error when multiple fields have errors', () => {
    const form = {
      getAllErrors: () => ({
        fields: {
          name: { errors: ['Name error'] },
          email: { errors: ['Email error'] },
        },
      }),
      state: { values: {} },
    }
    const schemas = [
      {
        name: 'name',
        label: 'Name',
        required: true,
        type: FormTypeEnum.textInput,
        show_on: [],
      },
      {
        name: 'email',
        label: 'Email',
        required: true,
        type: FormTypeEnum.textInput,
        show_on: [],
      },
    ]

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, schemas))

    expect(result.current.checkValidated()).toBe(false)
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'Name error',
    })
    expect(mockNotify).toHaveBeenCalledTimes(1)
  })

  it('should notify when multiple conditions all match', () => {
    const form = {
      getAllErrors: () => ({
        fields: {
          advancedOption: { errors: ['Advanced is required'] },
        },
      }),
      state: { values: { enabled: 'true', level: 'advanced' } },
    }
    const schemas = [{
      name: 'advancedOption',
      label: 'Advanced Option',
      required: true,
      type: FormTypeEnum.textInput,
      show_on: [
        { variable: 'enabled', value: 'true' },
        { variable: 'level', value: 'advanced' },
      ],
    }]

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, schemas))

    expect(result.current.checkValidated()).toBe(false)
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'Advanced is required',
    })
  })

  it('should ignore error when one of multiple conditions does not match', () => {
    const form = {
      getAllErrors: () => ({
        fields: {
          advancedOption: { errors: ['Advanced is required'] },
        },
      }),
      state: { values: { enabled: 'true', level: 'basic' } },
    }
    const schemas = [{
      name: 'advancedOption',
      label: 'Advanced Option',
      required: true,
      type: FormTypeEnum.textInput,
      show_on: [
        { variable: 'enabled', value: 'true' },
        { variable: 'level', value: 'advanced' },
      ],
    }]

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, schemas))

    expect(result.current.checkValidated()).toBe(true)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('should handle field with error when schema is not found', () => {
    const form = {
      getAllErrors: () => ({
        fields: {
          unknownField: { errors: ['Unknown error'] },
        },
      }),
      state: { values: {} },
    }
    const schemas = [{
      name: 'knownField',
      label: 'Known Field',
      required: true,
      type: FormTypeEnum.textInput,
      show_on: [],
    }]

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, schemas))

    expect(result.current.checkValidated()).toBe(false)
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'Unknown error',
    })
    expect(mockNotify).toHaveBeenCalledTimes(1)
  })

  it('should handle field with multiple errors and notify only first one', () => {
    const form = {
      getAllErrors: () => ({
        fields: {
          field1: { errors: ['First error', 'Second error'] },
        },
      }),
      state: { values: {} },
    }
    const schemas = [{
      name: 'field1',
      label: 'Field 1',
      required: true,
      type: FormTypeEnum.textInput,
      show_on: [],
    }]

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, schemas))

    expect(result.current.checkValidated()).toBe(false)
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'First error',
    })
  })

  it('should return true when all visible fields have no errors', () => {
    const form = {
      getAllErrors: () => ({
        fields: {
          visibleField: { errors: [] },
          hiddenField: { errors: [] },
        },
      }),
      state: { values: { showHidden: 'false' } },
    }
    const schemas = [
      {
        name: 'visibleField',
        label: 'Visible Field',
        required: true,
        type: FormTypeEnum.textInput,
        show_on: [],
      },
      {
        name: 'hiddenField',
        label: 'Hidden Field',
        required: true,
        type: FormTypeEnum.textInput,
        show_on: [{ variable: 'showHidden', value: 'true' }],
      },
    ]

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, schemas))

    expect(result.current.checkValidated()).toBe(true)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('should properly evaluate show_on conditions with different values', () => {
    const form = {
      getAllErrors: () => ({
        fields: {
          numericField: { errors: ['Numeric error'] },
        },
      }),
      state: { values: { threshold: '100' } },
    }
    const schemas = [{
      name: 'numericField',
      label: 'Numeric Field',
      required: true,
      type: FormTypeEnum.textInput,
      show_on: [{ variable: 'threshold', value: '100' }],
    }]

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, schemas))

    expect(result.current.checkValidated()).toBe(false)
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'Numeric error',
    })
  })
})
