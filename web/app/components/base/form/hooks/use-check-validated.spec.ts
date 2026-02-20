import type { AnyFormApi } from '@tanstack/react-form'
import { renderHook } from '@testing-library/react'
import { FormTypeEnum } from '../types'
import { useCheckValidated } from './use-check-validated'

const mockNotify = vi.fn()

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
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

  it('should notify and return false when visible field has errors', () => {
    const form = {
      getAllErrors: () => ({
        fields: {
          name: { errors: ['Name is required'] },
        },
      }),
      state: { values: {} },
    }
    const schemas = [{
      name: 'name',
      label: 'Name',
      required: true,
      type: FormTypeEnum.textInput,
      show_on: [],
    }]

    const { result } = renderHook(() => useCheckValidated(form as unknown as AnyFormApi, schemas))

    expect(result.current.checkValidated()).toBe(false)
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'Name is required',
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
})
