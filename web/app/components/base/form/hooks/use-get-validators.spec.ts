import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { FormTypeEnum } from '../types'
import { useGetValidators } from './use-get-validators'

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (obj: Record<string, string>) => obj.en_US,
}))

describe('useGetValidators', () => {
  it('should create required validators when field is required without custom validators', () => {
    const { result } = renderHook(() => useGetValidators())
    const validators = result.current.getValidators({
      name: 'username',
      label: 'Username',
      required: true,
      type: FormTypeEnum.textInput,
    })

    const mountMessage = validators?.onMount?.({ value: '' })
    const blurMessage = validators?.onBlur?.({ value: '' })

    expect(mountMessage).toContain('common.errorMsg.fieldRequired')
    expect(mountMessage).toContain('"field":"Username"')
    expect(blurMessage).toContain('common.errorMsg.fieldRequired')
  })

  it('should keep existing validators when custom validators are provided', () => {
    const customValidators = {
      onChange: vi.fn(() => 'custom error'),
    }
    const { result } = renderHook(() => useGetValidators())

    const validators = result.current.getValidators({
      name: 'username',
      label: 'Username',
      required: true,
      type: FormTypeEnum.textInput,
      validators: customValidators,
    })

    expect(validators).toBe(customValidators)
  })

  it('should fallback to field name when label is a react element', () => {
    const { result } = renderHook(() => useGetValidators())
    const validators = result.current.getValidators({
      name: 'apiKey',
      label: createElement('span', undefined, 'API Key'),
      required: true,
      type: FormTypeEnum.textInput,
    })

    const mountMessage = validators?.onMount?.({ value: '' })
    expect(mountMessage).toContain('"field":"apiKey"')
  })

  it('should translate object labels and skip validators for non-required fields', () => {
    const { result } = renderHook(() => useGetValidators())

    const requiredValidators = result.current.getValidators({
      name: 'workspace',
      label: { en_US: 'Workspace', zh_Hans: '工作区' },
      required: true,
      type: FormTypeEnum.textInput,
    })
    const nonRequiredValidators = result.current.getValidators({
      name: 'optionalField',
      label: 'Optional',
      required: false,
      type: FormTypeEnum.textInput,
    })

    const changeMessage = requiredValidators?.onChange?.({ value: '' })
    expect(changeMessage).toContain('"field":"Workspace"')
    expect(nonRequiredValidators).toBeUndefined()
  })
})
