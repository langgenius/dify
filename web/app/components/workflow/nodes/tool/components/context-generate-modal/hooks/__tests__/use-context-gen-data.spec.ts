import type { ContextGenerateResponse } from '@/service/debug'
import { act, renderHook, waitFor } from '@testing-library/react'
import useContextGenData from '../use-context-gen-data'

const createVersion = (code: string): ContextGenerateResponse => ({
  variables: [{ variable: 'result', value_selector: ['result'] }],
  outputs: { result: { type: 'string' } },
  code,
  code_language: 'python3',
  message: '',
  error: '',
})

describe('useContextGenData', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('should append versions and select the latest one by default', async () => {
    const { result } = renderHook(() => useContextGenData({ storageKey: 'tool-query' }))

    await act(async () => {
      result.current.addVersion(createVersion('print(1)'))
    })

    await waitFor(() => {
      expect(result.current.versions).toHaveLength(1)
      expect(result.current.currentVersionIndex).toBe(0)
      expect(result.current.current?.code).toBe('print(1)')
    })

    await act(async () => {
      result.current.addVersion(createVersion('print(2)'))
    })

    await waitFor(() => {
      expect(result.current.versions).toHaveLength(2)
      expect(result.current.currentVersionIndex).toBe(1)
      expect(result.current.current?.code).toBe('print(2)')
    })
  })

  it('should allow switching versions and clearing persisted state', async () => {
    const { result } = renderHook(() => useContextGenData({ storageKey: 'tool-query' }))

    await act(async () => {
      result.current.addVersion(createVersion('print(1)'))
    })

    await act(async () => {
      result.current.addVersion(createVersion('print(2)'))
    })

    await act(async () => {
      result.current.setCurrentVersionIndex(0)
    })

    await waitFor(() => {
      expect(result.current.current?.code).toBe('print(1)')
    })

    await act(async () => {
      result.current.clearVersions()
    })

    await waitFor(() => {
      expect(result.current.versions).toEqual([])
      expect(result.current.currentVersionIndex).toBe(0)
      expect(result.current.current).toBeUndefined()
    })
  })

  it('should append into an empty persisted list when the setter receives an undefined previous value', async () => {
    vi.resetModules()
    const setVersions = vi.fn()
    const setCurrentVersionIndex = vi.fn()

    vi.doMock('ahooks', () => ({
      useSessionStorageState: (key: string) => {
        if (key.endsWith('versions'))
          return [undefined, setVersions]
        return [0, setCurrentVersionIndex]
      },
    }))

    const { default: useContextGenDataWithMock } = await import('../use-context-gen-data')
    const { result } = renderHook(() => useContextGenDataWithMock({ storageKey: 'tool-query' }))
    const version = createVersion('print(3)')

    act(() => {
      result.current.addVersion(version)
    })

    const updater = setVersions.mock.calls[0]?.[0] as ((prev?: ContextGenerateResponse[]) => ContextGenerateResponse[])
    expect(updater(undefined)).toEqual([version])
    vi.resetModules()
  })
})
