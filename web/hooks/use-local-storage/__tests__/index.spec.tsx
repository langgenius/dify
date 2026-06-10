import { act, renderHook } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { useLocalStorage } from '../index'

describe('useLocalStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  it('should return server value and persist it when storage is empty', () => {
    const { result } = renderHook(() => useLocalStorage('shape', 'circle'))

    expect(result.current[0]).toBe('circle')
    expect(window.localStorage.getItem('shape')).toBe(JSON.stringify('circle'))
  })

  it('should prefer stored value over server value', () => {
    window.localStorage.setItem('shape', JSON.stringify('square'))

    const { result } = renderHook(() => useLocalStorage('shape', 'circle'))

    expect(result.current[0]).toBe('square')
    expect(window.localStorage.getItem('shape')).toBe(JSON.stringify('square'))
  })

  it('should update storage and subscribers from setter calls', () => {
    const { result } = renderHook(() => useLocalStorage('shape', 'circle'))

    act(() => {
      result.current[1]('triangle')
    })

    expect(result.current[0]).toBe('triangle')
    expect(window.localStorage.getItem('shape')).toBe(JSON.stringify('triangle'))
  })

  it('should support updater functions and null removal', () => {
    const { result } = renderHook(() => useLocalStorage<number>('count', 1))

    act(() => {
      result.current[1](current => (current ?? 0) + 1)
    })

    expect(result.current[0]).toBe(2)
    expect(window.localStorage.getItem('count')).toBe(JSON.stringify(2))

    act(() => {
      result.current[1](null)
    })

    expect(result.current[0]).toBe(1)
    expect(window.localStorage.getItem('count')).toBeNull()
  })

  it('should update from cross-tab storage events', () => {
    const { result } = renderHook(() => useLocalStorage('shape', 'circle'))

    window.localStorage.setItem('shape', JSON.stringify('square'))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'shape' }))
    })

    expect(result.current[0]).toBe('square')
  })

  it('should support raw string values', () => {
    const { result } = renderHook(() => useLocalStorage('raw-shape', 'circle', { raw: true }))

    act(() => {
      result.current[1]('square')
    })

    expect(result.current[0]).toBe('square')
    expect(window.localStorage.getItem('raw-shape')).toBe('square')
  })

  it('should render with server value during server rendering', () => {
    const Component = () => {
      const [value] = useLocalStorage('shape', 'circle')
      return <div>{value}</div>
    }

    expect(renderToString(<Component />)).toContain('circle')
  })

  it('should throw a recoverable no-SSR error during server rendering without server value', () => {
    const Component = () => {
      const [value] = useLocalStorage<string>('shape')
      return <div>{value}</div>
    }

    expect(() => renderToString(<Component />)).toThrow('[foxact/use-local-storage] cannot be used on the server without a serverValue')
  })
})
