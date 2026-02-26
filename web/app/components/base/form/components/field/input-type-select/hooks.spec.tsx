import { renderHook } from '@testing-library/react'
import { useInputTypeOptions } from './hooks'

describe('useInputTypeOptions', () => {
  it('should include file options when supportFile is true', () => {
    const { result } = renderHook(() => useInputTypeOptions(true))
    const values = result.current.map(item => item.value)

    expect(values).toContain('file')
    expect(values).toContain('file-list')
  })

  it('should exclude file options when supportFile is false', () => {
    const { result } = renderHook(() => useInputTypeOptions(false))
    const values = result.current.map(item => item.value)

    expect(values).not.toContain('file')
    expect(values).not.toContain('file-list')
  })
})
