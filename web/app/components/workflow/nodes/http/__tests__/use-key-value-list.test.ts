import { renderHook, waitFor } from '@testing-library/react'
import { uniqueId } from 'es-toolkit/compat'
import { useCallback, useState } from 'react'
import { useBoolean } from 'ahooks'
import useKeyValueList from '../hooks/use-key-value-list'

vi.mock('ahooks', () => ({
  useBoolean: (initial: boolean) => {
    const [state, setState] = useState(initial)
    const toggle = useCallback(() => {
      setState((prev) => !prev)
    }, [])
    return [state, { toggle }]
  },
}))

vi.mock('es-toolkit/compat', () => ({
  uniqueId: (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`,
}))

describe('useKeyValueList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves values with additional colons after parse', async () => {
    const onChange = vi.fn()
    const { result } = renderHook(() =>
      useKeyValueList('Authorization:Bearer ***:header:6555', onChange),
    )

    await waitFor(() => expect(result.current.list).toHaveLength(1))
    expect(result.current.list[0].key).toBe('Authorization')
    expect(result.current.list[0].value).toBe('Bearer ***:header:6555')
  })

  it('preserves multiline values containing colons after parse', async () => {
    const onChange = vi.fn()
    const { result } = renderHook(() =>
      useKeyValueList('Content-Type:application/json\nAuthorization:Bearer ***:header:6555', onChange),
    )

    await waitFor(() => expect(result.current.list).toHaveLength(2))
    expect(result.current.list).toEqual([
      { id: expect.any(String), key: 'Content-Type', value: 'application/json' },
      { id: expect.any(String), key: 'Authorization', value: 'Bearer ***:header:6555' },
    ])
  })

  it('preserves url values containing colons after parse', async () => {
    const onChange = vi.fn()
    const { result } = renderHook(() =>
      useKeyValueList('url:https://example.com:443/path', onChange),
    )

    await waitFor(() => expect(result.current.list).toHaveLength(1))
    expect(result.current.list[0].key).toBe('url')
    expect(result.current.list[0].value).toBe('https://example.com:443/path')
  })
})
