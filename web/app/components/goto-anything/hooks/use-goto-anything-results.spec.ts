import type { SearchResult } from '../actions/types'
import { renderHook } from '@testing-library/react'
import { useGotoAnythingResults } from './use-goto-anything-results'

type MockQueryResult = {
  data: Array<{ id: string, type: string, title: string }> | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
}

type UseQueryOptions = {
  queryFn: () => Promise<SearchResult[]>
}

let mockQueryResult: MockQueryResult = { data: [], isLoading: false, isError: false, error: null }
let capturedQueryFn: (() => Promise<SearchResult[]>) | null = null

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: UseQueryOptions) => {
    capturedQueryFn = options.queryFn
    return mockQueryResult
  },
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
}))

const mockMatchAction = vi.fn()
const mockSearchAnything = vi.fn()

vi.mock('../actions', () => ({
  matchAction: (...args: unknown[]) => mockMatchAction(...args),
  searchAnything: (...args: unknown[]) => mockSearchAnything(...args),
}))

const createMockActionItem = (key: '@app' | '@knowledge' | '@plugin' | '@node' | '/') => ({
  key,
  shortcut: key,
  title: `${key} title`,
  description: `${key} description`,
  search: vi.fn().mockResolvedValue([]),
})

const createMockOptions = (overrides = {}) => ({
  searchQueryDebouncedValue: '',
  searchMode: 'general',
  isCommandsMode: false,
  Actions: { app: createMockActionItem('@app') },
  isWorkflowPage: false,
  isRagPipelinePage: false,
  cmdVal: '_',
  setCmdVal: vi.fn(),
  ...overrides,
})

describe('useGotoAnythingResults', () => {
  beforeEach(() => {
    mockQueryResult = { data: [], isLoading: false, isError: false, error: null }
    capturedQueryFn = null
    mockMatchAction.mockReset()
    mockSearchAnything.mockReset()
  })

  describe('initialization', () => {
    it('should return empty arrays when no results', () => {
      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(result.current.searchResults).toEqual([])
      expect(result.current.dedupedResults).toEqual([])
      expect(result.current.groupedResults).toEqual({})
    })

    it('should return loading state', () => {
      mockQueryResult = { data: [], isLoading: true, isError: false, error: null }
      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(result.current.isLoading).toBe(true)
    })

    it('should return error state', () => {
      const error = new Error('Test error')
      mockQueryResult = { data: [], isLoading: false, isError: true, error }
      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(result.current.isError).toBe(true)
      expect(result.current.error).toBe(error)
    })
  })

  describe('dedupedResults', () => {
    it('should remove duplicate results', () => {
      mockQueryResult = {
        data: [
          { id: '1', type: 'app', title: 'App 1' },
          { id: '1', type: 'app', title: 'App 1 Duplicate' },
          { id: '2', type: 'app', title: 'App 2' },
        ],
        isLoading: false,
        isError: false,
        error: null,
      }

      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(result.current.dedupedResults).toHaveLength(2)
      expect(result.current.dedupedResults[0].id).toBe('1')
      expect(result.current.dedupedResults[1].id).toBe('2')
    })

    it('should keep first occurrence when duplicates exist', () => {
      mockQueryResult = {
        data: [
          { id: '1', type: 'app', title: 'First' },
          { id: '1', type: 'app', title: 'Second' },
        ],
        isLoading: false,
        isError: false,
        error: null,
      }

      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(result.current.dedupedResults).toHaveLength(1)
      expect(result.current.dedupedResults[0].title).toBe('First')
    })

    it('should handle different types with same id', () => {
      mockQueryResult = {
        data: [
          { id: '1', type: 'app', title: 'App' },
          { id: '1', type: 'plugin', title: 'Plugin' },
        ],
        isLoading: false,
        isError: false,
        error: null,
      }

      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      // Different types, same id = different keys, so both should remain
      expect(result.current.dedupedResults).toHaveLength(2)
    })
  })

  describe('groupedResults', () => {
    it('should group results by type', () => {
      mockQueryResult = {
        data: [
          { id: '1', type: 'app', title: 'App 1' },
          { id: '2', type: 'app', title: 'App 2' },
          { id: '3', type: 'plugin', title: 'Plugin 1' },
        ],
        isLoading: false,
        isError: false,
        error: null,
      }

      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(result.current.groupedResults.app).toHaveLength(2)
      expect(result.current.groupedResults.plugin).toHaveLength(1)
    })

    it('should handle single type', () => {
      mockQueryResult = {
        data: [
          { id: '1', type: 'knowledge', title: 'KB 1' },
          { id: '2', type: 'knowledge', title: 'KB 2' },
        ],
        isLoading: false,
        isError: false,
        error: null,
      }

      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(Object.keys(result.current.groupedResults)).toEqual(['knowledge'])
      expect(result.current.groupedResults.knowledge).toHaveLength(2)
    })

    it('should return empty object when no results', () => {
      mockQueryResult = { data: [], isLoading: false, isError: false, error: null }

      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(result.current.groupedResults).toEqual({})
    })
  })

  describe('auto-select first result', () => {
    it('should call setCmdVal when results change and current value does not exist', () => {
      const setCmdVal = vi.fn()
      mockQueryResult = {
        data: [{ id: '1', type: 'app', title: 'App 1' }],
        isLoading: false,
        isError: false,
        error: null,
      }

      renderHook(() => useGotoAnythingResults(createMockOptions({
        cmdVal: 'non-existent',
        setCmdVal,
      })))

      expect(setCmdVal).toHaveBeenCalledWith('app-1')
    })

    it('should NOT call setCmdVal when in commands mode', () => {
      const setCmdVal = vi.fn()
      mockQueryResult = {
        data: [{ id: '1', type: 'app', title: 'App 1' }],
        isLoading: false,
        isError: false,
        error: null,
      }

      renderHook(() => useGotoAnythingResults(createMockOptions({
        isCommandsMode: true,
        setCmdVal,
      })))

      expect(setCmdVal).not.toHaveBeenCalled()
    })

    it('should NOT call setCmdVal when results are empty', () => {
      const setCmdVal = vi.fn()
      mockQueryResult = { data: [], isLoading: false, isError: false, error: null }

      renderHook(() => useGotoAnythingResults(createMockOptions({
        setCmdVal,
      })))

      expect(setCmdVal).not.toHaveBeenCalled()
    })

    it('should NOT call setCmdVal when current value exists in results', () => {
      const setCmdVal = vi.fn()
      mockQueryResult = {
        data: [
          { id: '1', type: 'app', title: 'App 1' },
          { id: '2', type: 'app', title: 'App 2' },
        ],
        isLoading: false,
        isError: false,
        error: null,
      }

      renderHook(() => useGotoAnythingResults(createMockOptions({
        cmdVal: 'app-2',
        setCmdVal,
      })))

      expect(setCmdVal).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should return error as Error | null', () => {
      const error = new Error('Search failed')
      mockQueryResult = { data: [], isLoading: false, isError: true, error }

      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(result.current.error).toBeInstanceOf(Error)
      expect(result.current.error?.message).toBe('Search failed')
    })

    it('should return null error when no error', () => {
      mockQueryResult = { data: [], isLoading: false, isError: false, error: null }

      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(result.current.error).toBeNull()
    })
  })

  describe('searchResults', () => {
    it('should return raw search results', () => {
      const mockData = [
        { id: '1', type: 'app', title: 'App 1' },
        { id: '2', type: 'plugin', title: 'Plugin 1' },
      ]
      mockQueryResult = { data: mockData, isLoading: false, isError: false, error: null }

      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(result.current.searchResults).toEqual(mockData)
    })

    it('should default to empty array when data is undefined', () => {
      mockQueryResult = { data: undefined, isLoading: false, isError: false, error: null }

      const { result } = renderHook(() => useGotoAnythingResults(createMockOptions()))

      expect(result.current.searchResults).toEqual([])
    })
  })

  describe('queryFn execution', () => {
    it('should call matchAction with lowercased query', async () => {
      const mockActions = { app: createMockActionItem('@app') }
      mockMatchAction.mockReturnValue({ key: '@app' })
      mockSearchAnything.mockResolvedValue([])

      renderHook(() => useGotoAnythingResults(createMockOptions({
        searchQueryDebouncedValue: 'TEST QUERY',
        Actions: mockActions,
      })))

      expect(capturedQueryFn).toBeDefined()
      await capturedQueryFn!()

      expect(mockMatchAction).toHaveBeenCalledWith('test query', mockActions)
    })

    it('should call searchAnything with correct parameters', async () => {
      const mockActions = { app: createMockActionItem('@app') }
      const mockAction = { key: '@app' }
      mockMatchAction.mockReturnValue(mockAction)
      mockSearchAnything.mockResolvedValue([{ id: '1', type: 'app', title: 'Result' }])

      renderHook(() => useGotoAnythingResults(createMockOptions({
        searchQueryDebouncedValue: 'My Query',
        Actions: mockActions,
      })))

      expect(capturedQueryFn).toBeDefined()
      const result = await capturedQueryFn!()

      expect(mockSearchAnything).toHaveBeenCalledWith('en_US', 'my query', mockAction, mockActions)
      expect(result).toEqual([{ id: '1', type: 'app', title: 'Result' }])
    })

    it('should handle searchAnything returning results', async () => {
      const expectedResults = [
        { id: '1', type: 'app', title: 'App 1' },
        { id: '2', type: 'plugin', title: 'Plugin 1' },
      ]
      mockMatchAction.mockReturnValue(null)
      mockSearchAnything.mockResolvedValue(expectedResults)

      renderHook(() => useGotoAnythingResults(createMockOptions({
        searchQueryDebouncedValue: 'search term',
      })))

      expect(capturedQueryFn).toBeDefined()
      const result = await capturedQueryFn!()

      expect(result).toEqual(expectedResults)
    })
  })
})
