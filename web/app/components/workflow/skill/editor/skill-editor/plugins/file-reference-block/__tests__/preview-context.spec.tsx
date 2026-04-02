import type { PropsWithChildren } from 'react'
import { renderHook } from '@testing-library/react'
import {
  FilePreviewContextProvider,
  useFilePreviewContext,
} from '../preview-context'

describe('FilePreviewContextProvider', () => {
  it('should fall back to the default disabled state without a provider', () => {
    const { result } = renderHook(() => useFilePreviewContext(context => context.enabled))

    expect(result.current).toBe(false)
  })

  it('should expose the full context value and update subscribers', () => {
    let enabled = true
    const wrapper = ({ children }: PropsWithChildren) => (
      <FilePreviewContextProvider value={{ enabled }}>
        {children}
      </FilePreviewContextProvider>
    )

    const { result, rerender } = renderHook(
      () => useFilePreviewContext(context => context.enabled),
      { wrapper },
    )

    expect(result.current).toBe(true)

    enabled = false
    rerender()

    expect(result.current).toBe(false)
  })

  it('should treat an undefined provider value as disabled', () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <FilePreviewContextProvider>
        {children}
      </FilePreviewContextProvider>
    )

    const { result } = renderHook(
      () => useFilePreviewContext(context => context.enabled),
      { wrapper },
    )

    expect(result.current).toBe(false)
  })
})
