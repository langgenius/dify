import type { ScopeDescriptor } from '../actions/types'
import { act, renderHook } from '@testing-library/react'
import { useGotoAnythingSearch } from './use-goto-anything-search'

let mockContextValue = { isWorkflowPage: false, isRagPipelinePage: false }
let mockMatchActionResult: ScopeDescriptor | undefined

const baseScopesMock: ScopeDescriptor[] = [
  { id: 'slash', shortcut: '/', title: 'Slash', description: 'Slash commands', search: vi.fn() },
  { id: 'app', shortcut: '@app', title: 'App', description: 'Search apps', search: vi.fn() },
  { id: 'knowledge', shortcut: '@knowledge', title: 'Knowledge', description: 'Search KB', search: vi.fn() },
]

const workflowScopesMock: ScopeDescriptor[] = [
  ...baseScopesMock,
  { id: 'node', shortcut: '@node', title: 'Node', description: 'Search nodes', search: vi.fn() },
]

const ragScopesMock: ScopeDescriptor[] = [
  ...baseScopesMock,
  { id: 'ragNode', shortcut: '@node', title: 'RAG Node', description: 'Search RAG nodes', search: vi.fn() },
]

vi.mock('ahooks', () => ({
  useDebounce: <T>(value: T) => value,
}))

vi.mock('../context', () => ({
  useGotoAnythingContext: () => mockContextValue,
}))

vi.mock('../actions', () => ({
  useGotoAnythingScopes: (context: { isWorkflowPage: boolean, isRagPipelinePage: boolean }) => {
    if (context.isWorkflowPage)
      return workflowScopesMock
    if (context.isRagPipelinePage)
      return ragScopesMock
    return baseScopesMock
  },
  matchAction: () => mockMatchActionResult,
}))

describe('useGotoAnythingSearch', () => {
  beforeEach(() => {
    mockContextValue = { isWorkflowPage: false, isRagPipelinePage: false }
    mockMatchActionResult = undefined
  })

  describe('initialization', () => {
    it('should initialize with empty search query', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(result.current.searchQuery).toBe('')
    })

    it('should initialize cmdVal with "_"', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(result.current.cmdVal).toBe('_')
    })

    it('should initialize searchMode as "general"', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(result.current.searchMode).toBe('general')
    })

    it('should initialize isCommandsMode as false', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(result.current.isCommandsMode).toBe(false)
    })

    it('should provide setSearchQuery function', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(typeof result.current.setSearchQuery).toBe('function')
    })

    it('should provide setCmdVal function', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(typeof result.current.setCmdVal).toBe('function')
    })

    it('should provide clearSelection function', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(typeof result.current.clearSelection).toBe('function')
    })
  })

  describe('scopes', () => {
    it('should provide scopes based on context', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(result.current.scopes).toBeDefined()
      expect(Array.isArray(result.current.scopes)).toBe(true)
    })

    it('should include node scope when on workflow page', () => {
      mockContextValue = { isWorkflowPage: true, isRagPipelinePage: false }
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(result.current.scopes.find(s => s.id === 'node')).toBeDefined()
    })

    it('should include ragNode scope when on RAG pipeline page', () => {
      mockContextValue = { isWorkflowPage: false, isRagPipelinePage: true }
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(result.current.scopes.find(s => s.id === 'ragNode')).toBeDefined()
    })

    it('should not include node scopes when on regular page', () => {
      mockContextValue = { isWorkflowPage: false, isRagPipelinePage: false }
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(result.current.scopes.find(s => s.id === 'node')).toBeUndefined()
      expect(result.current.scopes.find(s => s.id === 'ragNode')).toBeUndefined()
    })
  })

  describe('isCommandsMode', () => {
    it('should return true when query is exactly "@"', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('@')
      })

      expect(result.current.isCommandsMode).toBe(true)
    })

    it('should return true when query is exactly "/"', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('/')
      })

      expect(result.current.isCommandsMode).toBe(true)
    })

    it('should return true when query starts with "@" and no action matches', () => {
      mockMatchActionResult = undefined
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('@unknown')
      })

      expect(result.current.isCommandsMode).toBe(true)
    })

    it('should return true when query starts with "/" and no action matches', () => {
      mockMatchActionResult = undefined
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('/unknown')
      })

      expect(result.current.isCommandsMode).toBe(true)
    })

    it('should return false when query starts with "@" and action matches', () => {
      mockMatchActionResult = baseScopesMock.find(s => s.id === 'app')
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('@app test')
      })

      expect(result.current.isCommandsMode).toBe(false)
    })

    it('should return false for regular search query', () => {
      mockMatchActionResult = undefined
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('hello world')
      })

      expect(result.current.isCommandsMode).toBe(false)
    })
  })

  describe('searchMode', () => {
    it('should return "general" when query is empty', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())
      expect(result.current.searchMode).toBe('general')
    })

    it('should return "scopes" when in commands mode and query starts with "@"', () => {
      mockMatchActionResult = undefined
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('@')
      })

      expect(result.current.searchMode).toBe('scopes')
    })

    it('should return "commands" when in commands mode and query starts with "/"', () => {
      mockMatchActionResult = undefined
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('/')
      })

      expect(result.current.searchMode).toBe('commands')
    })

    it('should return "general" when no action matches', () => {
      mockMatchActionResult = undefined
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('hello')
      })

      expect(result.current.searchMode).toBe('general')
    })

    it('should return action shortcut when action matches', () => {
      mockMatchActionResult = baseScopesMock.find(s => s.id === 'app')
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('@app test')
      })

      expect(result.current.searchMode).toBe('@app')
    })

    it('should return "@command" when action is slash', () => {
      mockMatchActionResult = baseScopesMock.find(s => s.id === 'slash')
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('/theme dark')
      })

      expect(result.current.searchMode).toBe('@command')
    })
  })

  describe('clearSelection', () => {
    it('should reset cmdVal to "_"', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())

      // First change cmdVal
      act(() => {
        result.current.setCmdVal('app-1')
      })
      expect(result.current.cmdVal).toBe('app-1')

      // Then clear
      act(() => {
        result.current.clearSelection()
      })

      expect(result.current.cmdVal).toBe('_')
    })
  })

  describe('setSearchQuery', () => {
    it('should update search query', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('test query')
      })

      expect(result.current.searchQuery).toBe('test query')
    })

    it('should handle empty string', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('test')
      })
      expect(result.current.searchQuery).toBe('test')

      act(() => {
        result.current.setSearchQuery('')
      })
      expect(result.current.searchQuery).toBe('')
    })
  })

  describe('setCmdVal', () => {
    it('should update cmdVal', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setCmdVal('plugin-2')
      })

      expect(result.current.cmdVal).toBe('plugin-2')
    })
  })

  describe('searchQueryDebouncedValue', () => {
    it('should return trimmed debounced value', () => {
      const { result } = renderHook(() => useGotoAnythingSearch())

      act(() => {
        result.current.setSearchQuery('  test  ')
      })

      // Since we mock useDebounce to return value directly
      expect(result.current.searchQueryDebouncedValue).toBe('test')
    })
  })
})
