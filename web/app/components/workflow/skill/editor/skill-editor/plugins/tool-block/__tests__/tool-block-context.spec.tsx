import type { PropsWithChildren } from 'react'
import { renderHook } from '@testing-library/react'
import {
  ToolBlockContextProvider,
  useToolBlockContext,
} from '../tool-block-context'

describe('ToolBlockContextProvider', () => {
  it('should fall back to a null context without a provider', () => {
    const { result } = renderHook(() => useToolBlockContext())

    expect(result.current).toBeNull()
  })

  it('should expose selected values and update subscribers', () => {
    let value = {
      nodeId: 'node-1',
      useModal: true,
      disableToolBlocks: false,
    }

    const wrapper = ({ children }: PropsWithChildren) => (
      <ToolBlockContextProvider value={value}>
        {children}
      </ToolBlockContextProvider>
    )

    const { result, rerender } = renderHook(
      () => useToolBlockContext(context => context?.nodeId),
      { wrapper },
    )

    expect(result.current).toBe('node-1')

    value = {
      nodeId: 'node-2',
      useModal: false,
      disableToolBlocks: true,
    }
    rerender()

    expect(result.current).toBe('node-2')
  })

  it('should treat an undefined provider value as null', () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <ToolBlockContextProvider>
        {children}
      </ToolBlockContextProvider>
    )

    const { result } = renderHook(() => useToolBlockContext(), { wrapper })

    expect(result.current).toBeNull()
  })
})
