import type * as React from 'react'
import type { Plugin } from '../../plugins/types'
import type { CommonNodeType } from '../../workflow/types'
import type { DataSet } from '@/models/datasets'
import type { App } from '@/types/app'
import { act, renderHook } from '@testing-library/react'
import { useGotoAnythingNavigation } from './use-goto-anything-navigation'

const mockRouterPush = vi.fn()
const mockSelectWorkflowNode = vi.fn()

type MockCommandResult = {
  mode: string
  execute?: () => void
} | null

let mockFindCommandResult: MockCommandResult = null

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

vi.mock('@/app/components/workflow/utils/node-navigation', () => ({
  selectWorkflowNode: (...args: unknown[]) => mockSelectWorkflowNode(...args),
}))

vi.mock('../actions/commands/registry', () => ({
  slashCommandRegistry: {
    findCommand: () => mockFindCommandResult,
  },
}))

const createMockActionItem = (
  key: '@app' | '@knowledge' | '@plugin' | '@node' | '/',
  extra: Record<string, unknown> = {},
) => ({
  key,
  shortcut: key,
  title: `${key} title`,
  description: `${key} description`,
  search: vi.fn().mockResolvedValue([]),
  ...extra,
})

const createMockOptions = (overrides = {}) => ({
  Actions: {
    slash: createMockActionItem('/', { action: vi.fn() }),
    app: createMockActionItem('@app'),
  },
  setSearchQuery: vi.fn(),
  clearSelection: vi.fn(),
  inputRef: { current: { focus: vi.fn() } } as unknown as React.RefObject<HTMLInputElement>,
  onClose: vi.fn(),
  ...overrides,
})

describe('useGotoAnythingNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindCommandResult = null
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initialization', () => {
    it('should return handleCommandSelect function', () => {
      const { result } = renderHook(() => useGotoAnythingNavigation(createMockOptions()))
      expect(typeof result.current.handleCommandSelect).toBe('function')
    })

    it('should return handleNavigate function', () => {
      const { result } = renderHook(() => useGotoAnythingNavigation(createMockOptions()))
      expect(typeof result.current.handleNavigate).toBe('function')
    })

    it('should initialize activePlugin as undefined', () => {
      const { result } = renderHook(() => useGotoAnythingNavigation(createMockOptions()))
      expect(result.current.activePlugin).toBeUndefined()
    })

    it('should return setActivePlugin function', () => {
      const { result } = renderHook(() => useGotoAnythingNavigation(createMockOptions()))
      expect(typeof result.current.setActivePlugin).toBe('function')
    })
  })

  describe('handleCommandSelect', () => {
    it('should execute direct mode slash command immediately', () => {
      const execute = vi.fn()
      mockFindCommandResult = { mode: 'direct', execute }
      const options = createMockOptions()

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleCommandSelect('/theme')
      })

      expect(execute).toHaveBeenCalled()
      expect(options.onClose).toHaveBeenCalled()
      expect(options.setSearchQuery).toHaveBeenCalledWith('')
    })

    it('should NOT execute when handler has no execute function', () => {
      mockFindCommandResult = { mode: 'direct', execute: undefined }
      const options = createMockOptions()

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleCommandSelect('/theme')
      })

      expect(options.onClose).not.toHaveBeenCalled()
      // Should proceed with submenu mode
      expect(options.setSearchQuery).toHaveBeenCalledWith('/theme ')
    })

    it('should proceed with submenu mode for non-direct commands', () => {
      mockFindCommandResult = { mode: 'submenu' }
      const options = createMockOptions()

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleCommandSelect('/language')
      })

      expect(options.setSearchQuery).toHaveBeenCalledWith('/language ')
      expect(options.clearSelection).toHaveBeenCalled()
    })

    it('should handle @ commands (scopes)', () => {
      const options = createMockOptions()

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleCommandSelect('@app')
      })

      expect(options.setSearchQuery).toHaveBeenCalledWith('@app ')
      expect(options.clearSelection).toHaveBeenCalled()
    })

    it('should focus input after setting search query', () => {
      const focusMock = vi.fn()
      const options = createMockOptions({
        inputRef: { current: { focus: focusMock } },
      })

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleCommandSelect('@app')
      })

      act(() => {
        vi.runAllTimers()
      })

      expect(focusMock).toHaveBeenCalled()
    })

    it('should handle null handler from registry', () => {
      mockFindCommandResult = null
      const options = createMockOptions()

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleCommandSelect('/unknown')
      })

      // Should proceed with submenu mode
      expect(options.setSearchQuery).toHaveBeenCalledWith('/unknown ')
    })
  })

  describe('handleNavigate', () => {
    it('should navigate to path for default result types', () => {
      const options = createMockOptions()

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleNavigate({
          id: '1',
          type: 'app' as const,
          title: 'My App',
          path: '/apps/1',
          data: { id: '1', name: 'My App' } as unknown as App,
        })
      })

      expect(options.onClose).toHaveBeenCalled()
      expect(options.setSearchQuery).toHaveBeenCalledWith('')
      expect(mockRouterPush).toHaveBeenCalledWith('/apps/1')
    })

    it('should NOT call router.push when path is empty', () => {
      const options = createMockOptions()

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleNavigate({
          id: '1',
          type: 'app' as const,
          title: 'My App',
          path: '',
          data: { id: '1', name: 'My App' } as unknown as App,
        })
      })

      expect(mockRouterPush).not.toHaveBeenCalled()
    })

    it('should execute slash command action for command type', () => {
      const actionMock = vi.fn()
      const options = createMockOptions({
        Actions: {
          slash: { key: '/', shortcut: '/', action: actionMock },
        },
      })

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      const commandResult = {
        id: 'cmd-1',
        type: 'command' as const,
        title: 'Theme Dark',
        data: { command: 'theme.set', args: { theme: 'dark' } },
      }

      act(() => {
        result.current.handleNavigate(commandResult)
      })

      expect(actionMock).toHaveBeenCalledWith(commandResult)
    })

    it('should set activePlugin for plugin type', () => {
      const options = createMockOptions()
      const pluginData = { name: 'My Plugin', latest_package_identifier: 'pkg' } as unknown as Plugin

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleNavigate({
          id: 'plugin-1',
          type: 'plugin' as const,
          title: 'My Plugin',
          data: pluginData,
        })
      })

      expect(result.current.activePlugin).toEqual(pluginData)
    })

    it('should select workflow node for workflow-node type', () => {
      const options = createMockOptions()

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleNavigate({
          id: 'node-1',
          type: 'workflow-node' as const,
          title: 'Start Node',
          metadata: { nodeId: 'node-123', nodeData: {} as CommonNodeType },
          data: { id: 'node-1' } as unknown as CommonNodeType,
        })
      })

      expect(mockSelectWorkflowNode).toHaveBeenCalledWith('node-123', true)
    })

    it('should NOT select workflow node when metadata.nodeId is missing', () => {
      const options = createMockOptions()

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleNavigate({
          id: 'node-1',
          type: 'workflow-node' as const,
          title: 'Start Node',
          metadata: undefined,
          data: { id: 'node-1' } as unknown as CommonNodeType,
        })
      })

      expect(mockSelectWorkflowNode).not.toHaveBeenCalled()
    })

    it('should handle knowledge type (default case with path)', () => {
      const options = createMockOptions()

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      act(() => {
        result.current.handleNavigate({
          id: 'kb-1',
          type: 'knowledge' as const,
          title: 'My Knowledge Base',
          path: '/datasets/kb-1',
          data: { id: 'kb-1', name: 'My Knowledge Base' } as unknown as DataSet,
        })
      })

      expect(mockRouterPush).toHaveBeenCalledWith('/datasets/kb-1')
    })
  })

  describe('setActivePlugin', () => {
    it('should update activePlugin state', () => {
      const { result } = renderHook(() => useGotoAnythingNavigation(createMockOptions()))

      const plugin = { name: 'Test Plugin', latest_package_identifier: 'test-pkg' } as unknown as Plugin
      act(() => {
        result.current.setActivePlugin(plugin)
      })

      expect(result.current.activePlugin).toEqual(plugin)
    })

    it('should clear activePlugin when set to undefined', () => {
      const { result } = renderHook(() => useGotoAnythingNavigation(createMockOptions()))

      // First set a plugin
      act(() => {
        result.current.setActivePlugin({ name: 'Plugin', latest_package_identifier: 'pkg' } as unknown as Plugin)
      })
      expect(result.current.activePlugin).toBeDefined()

      // Then clear it
      act(() => {
        result.current.setActivePlugin(undefined)
      })

      expect(result.current.activePlugin).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('should handle undefined inputRef.current', () => {
      const options = createMockOptions({
        inputRef: { current: null },
      })

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      // Should not throw
      act(() => {
        result.current.handleCommandSelect('@app')
      })

      act(() => {
        vi.runAllTimers()
      })

      // No error should occur
    })

    it('should handle missing slash action', () => {
      const options = createMockOptions({
        Actions: {},
      })

      const { result } = renderHook(() => useGotoAnythingNavigation(options))

      // Should not throw
      act(() => {
        result.current.handleNavigate({
          id: 'cmd-1',
          type: 'command' as const,
          title: 'Command',
          data: { command: 'test-command' },
        })
      })

      // No error should occur
    })
  })
})
