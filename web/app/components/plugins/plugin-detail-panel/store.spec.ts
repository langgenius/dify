import type { SimpleDetail } from './store'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePluginStore } from './store'

// Factory function to create mock SimpleDetail
const createSimpleDetail = (overrides: Partial<SimpleDetail> = {}): SimpleDetail => ({
  plugin_id: 'test-plugin-id',
  name: 'Test Plugin',
  plugin_unique_identifier: 'test-plugin-uid',
  id: 'test-id',
  provider: 'test-provider',
  declaration: {
    category: 'tool' as SimpleDetail['declaration']['category'],
    name: 'test-declaration',
  },
  ...overrides,
})

describe('usePluginStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    const { result } = renderHook(() => usePluginStore())
    act(() => {
      result.current.setDetail(undefined)
    })
  })

  describe('Initial State', () => {
    it('should have undefined detail initially', () => {
      const { result } = renderHook(() => usePluginStore())

      expect(result.current.detail).toBeUndefined()
    })

    it('should provide setDetail function', () => {
      const { result } = renderHook(() => usePluginStore())

      expect(typeof result.current.setDetail).toBe('function')
    })
  })

  describe('setDetail', () => {
    it('should set detail with valid SimpleDetail', () => {
      const { result } = renderHook(() => usePluginStore())
      const detail = createSimpleDetail()

      act(() => {
        result.current.setDetail(detail)
      })

      expect(result.current.detail).toEqual(detail)
    })

    it('should set detail to undefined', () => {
      const { result } = renderHook(() => usePluginStore())
      const detail = createSimpleDetail()

      // First set a value
      act(() => {
        result.current.setDetail(detail)
      })
      expect(result.current.detail).toEqual(detail)

      // Then clear it
      act(() => {
        result.current.setDetail(undefined)
      })
      expect(result.current.detail).toBeUndefined()
    })

    it('should update detail when called multiple times', () => {
      const { result } = renderHook(() => usePluginStore())
      const detail1 = createSimpleDetail({ plugin_id: 'plugin-1' })
      const detail2 = createSimpleDetail({ plugin_id: 'plugin-2' })

      act(() => {
        result.current.setDetail(detail1)
      })
      expect(result.current.detail?.plugin_id).toBe('plugin-1')

      act(() => {
        result.current.setDetail(detail2)
      })
      expect(result.current.detail?.plugin_id).toBe('plugin-2')
    })

    it('should handle detail with trigger declaration', () => {
      const { result } = renderHook(() => usePluginStore())
      const detail = createSimpleDetail({
        declaration: {
          trigger: {
            subscription_schema: [],
            subscription_constructor: null,
          },
        },
      })

      act(() => {
        result.current.setDetail(detail)
      })

      expect(result.current.detail?.declaration.trigger).toEqual({
        subscription_schema: [],
        subscription_constructor: null,
      })
    })

    it('should handle detail with partial declaration', () => {
      const { result } = renderHook(() => usePluginStore())
      const detail = createSimpleDetail({
        declaration: {
          name: 'partial-plugin',
        },
      })

      act(() => {
        result.current.setDetail(detail)
      })

      expect(result.current.detail?.declaration.name).toBe('partial-plugin')
    })
  })

  describe('Store Sharing', () => {
    it('should share state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => usePluginStore())
      const { result: result2 } = renderHook(() => usePluginStore())
      const detail = createSimpleDetail()

      act(() => {
        result1.current.setDetail(detail)
      })

      // Both hooks should see the same state
      expect(result1.current.detail).toEqual(detail)
      expect(result2.current.detail).toEqual(detail)
    })

    it('should update all hook instances when state changes', () => {
      const { result: result1 } = renderHook(() => usePluginStore())
      const { result: result2 } = renderHook(() => usePluginStore())
      const detail1 = createSimpleDetail({ name: 'Plugin One' })
      const detail2 = createSimpleDetail({ name: 'Plugin Two' })

      act(() => {
        result1.current.setDetail(detail1)
      })

      expect(result1.current.detail?.name).toBe('Plugin One')
      expect(result2.current.detail?.name).toBe('Plugin One')

      act(() => {
        result2.current.setDetail(detail2)
      })

      expect(result1.current.detail?.name).toBe('Plugin Two')
      expect(result2.current.detail?.name).toBe('Plugin Two')
    })
  })

  describe('Selector Pattern', () => {
    // Extract selectors to reduce nesting depth
    const selectDetail = (state: ReturnType<typeof usePluginStore.getState>) => state.detail
    const selectSetDetail = (state: ReturnType<typeof usePluginStore.getState>) => state.setDetail

    it('should support selector to get specific field', () => {
      const { result: setterResult } = renderHook(() => usePluginStore())
      const detail = createSimpleDetail({ plugin_id: 'selected-plugin' })

      act(() => {
        setterResult.current.setDetail(detail)
      })

      // Use selector to get only detail
      const { result: selectorResult } = renderHook(() => usePluginStore(selectDetail))

      expect(selectorResult.current?.plugin_id).toBe('selected-plugin')
    })

    it('should support selector to get setDetail function', () => {
      const { result } = renderHook(() => usePluginStore(selectSetDetail))

      expect(typeof result.current).toBe('function')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string values in detail', () => {
      const { result } = renderHook(() => usePluginStore())
      const detail = createSimpleDetail({
        plugin_id: '',
        name: '',
        plugin_unique_identifier: '',
        provider: '',
      })

      act(() => {
        result.current.setDetail(detail)
      })

      expect(result.current.detail?.plugin_id).toBe('')
      expect(result.current.detail?.name).toBe('')
    })

    it('should handle detail with empty declaration', () => {
      const { result } = renderHook(() => usePluginStore())
      const detail = createSimpleDetail({
        declaration: {},
      })

      act(() => {
        result.current.setDetail(detail)
      })

      expect(result.current.detail?.declaration).toEqual({})
    })

    it('should handle rapid state updates', () => {
      const { result } = renderHook(() => usePluginStore())

      act(() => {
        for (let i = 0; i < 10; i++)
          result.current.setDetail(createSimpleDetail({ plugin_id: `plugin-${i}` }))
      })

      expect(result.current.detail?.plugin_id).toBe('plugin-9')
    })

    it('should handle setDetail called without arguments', () => {
      const { result } = renderHook(() => usePluginStore())
      const detail = createSimpleDetail()

      act(() => {
        result.current.setDetail(detail)
      })
      expect(result.current.detail).toBeDefined()

      act(() => {
        result.current.setDetail()
      })
      expect(result.current.detail).toBeUndefined()
    })
  })

  describe('Type Safety', () => {
    it('should preserve all SimpleDetail fields correctly', () => {
      const { result } = renderHook(() => usePluginStore())
      const detail: SimpleDetail = {
        plugin_id: 'type-test-id',
        name: 'Type Test Plugin',
        plugin_unique_identifier: 'type-test-uid',
        id: 'type-id',
        provider: 'type-provider',
        declaration: {
          category: 'model' as SimpleDetail['declaration']['category'],
          name: 'type-declaration',
          version: '2.0.0',
          author: 'test-author',
        },
      }

      act(() => {
        result.current.setDetail(detail)
      })

      expect(result.current.detail).toStrictEqual(detail)
      expect(result.current.detail?.plugin_id).toBe('type-test-id')
      expect(result.current.detail?.name).toBe('Type Test Plugin')
      expect(result.current.detail?.plugin_unique_identifier).toBe('type-test-uid')
      expect(result.current.detail?.id).toBe('type-id')
      expect(result.current.detail?.provider).toBe('type-provider')
    })

    it('should handle declaration with subscription_constructor', () => {
      const { result } = renderHook(() => usePluginStore())
      const mockConstructor = {
        credentials_schema: [],
        oauth_schema: {
          client_schema: [],
          credentials_schema: [],
        },
        parameters: [],
      }

      const detail = createSimpleDetail({
        declaration: {
          trigger: {
            subscription_schema: [],
            subscription_constructor: mockConstructor as unknown as NonNullable<SimpleDetail['declaration']['trigger']>['subscription_constructor'],
          },
        },
      })

      act(() => {
        result.current.setDetail(detail)
      })

      expect(result.current.detail?.declaration.trigger?.subscription_constructor).toBeDefined()
    })

    it('should handle declaration with subscription_schema', () => {
      const { result } = renderHook(() => usePluginStore())

      const detail = createSimpleDetail({
        declaration: {
          trigger: {
            subscription_schema: [],
            subscription_constructor: null,
          },
        },
      })

      act(() => {
        result.current.setDetail(detail)
      })

      expect(result.current.detail?.declaration.trigger?.subscription_schema).toEqual([])
    })
  })

  describe('State Persistence', () => {
    it('should maintain state after multiple renders', () => {
      const detail = createSimpleDetail({ name: 'Persistent Plugin' })

      const { result, rerender } = renderHook(() => usePluginStore())

      act(() => {
        result.current.setDetail(detail)
      })

      // Rerender multiple times
      rerender()
      rerender()
      rerender()

      expect(result.current.detail?.name).toBe('Persistent Plugin')
    })

    it('should maintain reference equality for unchanged state', () => {
      const { result } = renderHook(() => usePluginStore())
      const detail = createSimpleDetail()

      act(() => {
        result.current.setDetail(detail)
      })

      const firstDetailRef = result.current.detail

      // Get state again without changing
      const { result: result2 } = renderHook(() => usePluginStore())

      expect(result2.current.detail).toBe(firstDetailRef)
    })
  })

  describe('Concurrent Updates', () => {
    it('should handle updates from multiple sources correctly', () => {
      const { result: hook1 } = renderHook(() => usePluginStore())
      const { result: hook2 } = renderHook(() => usePluginStore())
      const { result: hook3 } = renderHook(() => usePluginStore())

      act(() => {
        hook1.current.setDetail(createSimpleDetail({ name: 'From Hook 1' }))
      })

      act(() => {
        hook2.current.setDetail(createSimpleDetail({ name: 'From Hook 2' }))
      })

      act(() => {
        hook3.current.setDetail(createSimpleDetail({ name: 'From Hook 3' }))
      })

      // All hooks should reflect the last update
      expect(hook1.current.detail?.name).toBe('From Hook 3')
      expect(hook2.current.detail?.name).toBe('From Hook 3')
      expect(hook3.current.detail?.name).toBe('From Hook 3')
    })

    it('should handle interleaved read and write operations', () => {
      const { result } = renderHook(() => usePluginStore())

      act(() => {
        result.current.setDetail(createSimpleDetail({ plugin_id: 'step-1' }))
      })
      expect(result.current.detail?.plugin_id).toBe('step-1')

      act(() => {
        result.current.setDetail(createSimpleDetail({ plugin_id: 'step-2' }))
      })
      expect(result.current.detail?.plugin_id).toBe('step-2')

      act(() => {
        result.current.setDetail(undefined)
      })
      expect(result.current.detail).toBeUndefined()

      act(() => {
        result.current.setDetail(createSimpleDetail({ plugin_id: 'step-3' }))
      })
      expect(result.current.detail?.plugin_id).toBe('step-3')
    })
  })

  describe('Declaration Variations', () => {
    it('should handle declaration with all optional fields', () => {
      const { result } = renderHook(() => usePluginStore())
      const detail = createSimpleDetail({
        declaration: {
          category: 'extension' as SimpleDetail['declaration']['category'],
          name: 'full-declaration',
          version: '1.0.0',
          author: 'full-author',
          icon: 'icon.png',
          verified: true,
          tags: ['tag1', 'tag2'],
        },
      })

      act(() => {
        result.current.setDetail(detail)
      })

      const decl = result.current.detail?.declaration
      expect(decl?.category).toBe('extension')
      expect(decl?.name).toBe('full-declaration')
      expect(decl?.version).toBe('1.0.0')
      expect(decl?.author).toBe('full-author')
      expect(decl?.icon).toBe('icon.png')
      expect(decl?.verified).toBe(true)
      expect(decl?.tags).toEqual(['tag1', 'tag2'])
    })

    it('should handle declaration with nested tool object', () => {
      const { result } = renderHook(() => usePluginStore())
      const mockTool = {
        identity: {
          author: 'tool-author',
          name: 'tool-name',
          icon: 'tool-icon.png',
          tags: ['api', 'utility'],
        },
        credentials_schema: [],
      }

      const detail = createSimpleDetail({
        declaration: {
          tool: mockTool as unknown as SimpleDetail['declaration']['tool'],
        },
      })

      act(() => {
        result.current.setDetail(detail)
      })

      expect(result.current.detail?.declaration.tool?.identity.name).toBe('tool-name')
      expect(result.current.detail?.declaration.tool?.identity.tags).toEqual(['api', 'utility'])
    })
  })
})
