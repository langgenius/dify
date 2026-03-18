import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { Provider } from 'jotai'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  useExpandModelProviderList,
  useModelProviderListExpanded,
  useResetModelProviderListExpanded,
  useSetModelProviderListExpanded,
} from '../atoms'

const createWrapper = () => {
  return ({ children }: { children: ReactNode }) => (
    <Provider>{children}</Provider>
  )
}

describe('atoms', () => {
  let wrapper: ReturnType<typeof createWrapper>

  beforeEach(() => {
    wrapper = createWrapper()
  })

  // Read hook: returns whether a specific provider is expanded
  describe('useModelProviderListExpanded', () => {
    it('should return false when provider has not been expanded', () => {
      const { result } = renderHook(
        () => useModelProviderListExpanded('openai'),
        { wrapper },
      )

      expect(result.current).toBe(false)
    })

    it('should return false for any unknown provider name', () => {
      const { result } = renderHook(
        () => useModelProviderListExpanded('nonexistent-provider'),
        { wrapper },
      )

      expect(result.current).toBe(false)
    })

    it('should return true when provider has been expanded via setter', () => {
      const { result } = renderHook(
        () => ({
          expanded: useModelProviderListExpanded('openai'),
          setExpanded: useSetModelProviderListExpanded('openai'),
        }),
        { wrapper },
      )

      act(() => {
        result.current.setExpanded(true)
      })

      expect(result.current.expanded).toBe(true)
    })
  })

  // Setter hook: toggles expanded state for a specific provider
  describe('useSetModelProviderListExpanded', () => {
    it('should expand a provider when called with true', () => {
      const { result } = renderHook(
        () => ({
          expanded: useModelProviderListExpanded('anthropic'),
          setExpanded: useSetModelProviderListExpanded('anthropic'),
        }),
        { wrapper },
      )

      act(() => {
        result.current.setExpanded(true)
      })

      expect(result.current.expanded).toBe(true)
    })

    it('should collapse a provider when called with false', () => {
      const { result } = renderHook(
        () => ({
          expanded: useModelProviderListExpanded('anthropic'),
          setExpanded: useSetModelProviderListExpanded('anthropic'),
        }),
        { wrapper },
      )

      act(() => {
        result.current.setExpanded(true)
      })
      act(() => {
        result.current.setExpanded(false)
      })

      expect(result.current.expanded).toBe(false)
    })

    it('should not affect other providers when setting one', () => {
      const { result } = renderHook(
        () => ({
          openaiExpanded: useModelProviderListExpanded('openai'),
          anthropicExpanded: useModelProviderListExpanded('anthropic'),
          setOpenai: useSetModelProviderListExpanded('openai'),
        }),
        { wrapper },
      )

      act(() => {
        result.current.setOpenai(true)
      })

      expect(result.current.openaiExpanded).toBe(true)
      expect(result.current.anthropicExpanded).toBe(false)
    })
  })

  // Expand hook: expands any provider by name
  describe('useExpandModelProviderList', () => {
    it('should expand the specified provider', () => {
      const { result } = renderHook(
        () => ({
          expanded: useModelProviderListExpanded('google'),
          expand: useExpandModelProviderList(),
        }),
        { wrapper },
      )

      act(() => {
        result.current.expand('google')
      })

      expect(result.current.expanded).toBe(true)
    })

    it('should expand multiple providers independently', () => {
      const { result } = renderHook(
        () => ({
          openaiExpanded: useModelProviderListExpanded('openai'),
          anthropicExpanded: useModelProviderListExpanded('anthropic'),
          expand: useExpandModelProviderList(),
        }),
        { wrapper },
      )

      act(() => {
        result.current.expand('openai')
      })
      act(() => {
        result.current.expand('anthropic')
      })

      expect(result.current.openaiExpanded).toBe(true)
      expect(result.current.anthropicExpanded).toBe(true)
    })

    it('should not collapse already expanded providers when expanding another', () => {
      const { result } = renderHook(
        () => ({
          openaiExpanded: useModelProviderListExpanded('openai'),
          anthropicExpanded: useModelProviderListExpanded('anthropic'),
          expand: useExpandModelProviderList(),
        }),
        { wrapper },
      )

      act(() => {
        result.current.expand('openai')
      })
      act(() => {
        result.current.expand('anthropic')
      })

      expect(result.current.openaiExpanded).toBe(true)
    })
  })

  // Reset hook: clears all expanded state back to empty
  describe('useResetModelProviderListExpanded', () => {
    it('should reset all expanded providers to false', () => {
      const { result } = renderHook(
        () => ({
          openaiExpanded: useModelProviderListExpanded('openai'),
          anthropicExpanded: useModelProviderListExpanded('anthropic'),
          expand: useExpandModelProviderList(),
          reset: useResetModelProviderListExpanded(),
        }),
        { wrapper },
      )

      act(() => {
        result.current.expand('openai')
      })
      act(() => {
        result.current.expand('anthropic')
      })
      act(() => {
        result.current.reset()
      })

      expect(result.current.openaiExpanded).toBe(false)
      expect(result.current.anthropicExpanded).toBe(false)
    })

    it('should be safe to call when no providers are expanded', () => {
      const { result } = renderHook(
        () => ({
          expanded: useModelProviderListExpanded('openai'),
          reset: useResetModelProviderListExpanded(),
        }),
        { wrapper },
      )

      act(() => {
        result.current.reset()
      })

      expect(result.current.expanded).toBe(false)
    })

    it('should allow re-expanding providers after reset', () => {
      const { result } = renderHook(
        () => ({
          expanded: useModelProviderListExpanded('openai'),
          expand: useExpandModelProviderList(),
          reset: useResetModelProviderListExpanded(),
        }),
        { wrapper },
      )

      act(() => {
        result.current.expand('openai')
      })
      act(() => {
        result.current.reset()
      })
      act(() => {
        result.current.expand('openai')
      })

      expect(result.current.expanded).toBe(true)
    })
  })

  // Cross-hook interaction: verify hooks cooperate through the shared atom
  describe('Cross-hook interaction', () => {
    it('should reflect state set by useSetModelProviderListExpanded in useModelProviderListExpanded', () => {
      const { result } = renderHook(
        () => ({
          expanded: useModelProviderListExpanded('openai'),
          setExpanded: useSetModelProviderListExpanded('openai'),
        }),
        { wrapper },
      )

      act(() => {
        result.current.setExpanded(true)
      })

      expect(result.current.expanded).toBe(true)
    })

    it('should reflect state set by useExpandModelProviderList in useModelProviderListExpanded', () => {
      const { result } = renderHook(
        () => ({
          expanded: useModelProviderListExpanded('anthropic'),
          expand: useExpandModelProviderList(),
        }),
        { wrapper },
      )

      act(() => {
        result.current.expand('anthropic')
      })

      expect(result.current.expanded).toBe(true)
    })

    it('should allow useSetModelProviderListExpanded to collapse a provider expanded by useExpandModelProviderList', () => {
      const { result } = renderHook(
        () => ({
          expanded: useModelProviderListExpanded('openai'),
          expand: useExpandModelProviderList(),
          setExpanded: useSetModelProviderListExpanded('openai'),
        }),
        { wrapper },
      )

      act(() => {
        result.current.expand('openai')
      })
      expect(result.current.expanded).toBe(true)

      act(() => {
        result.current.setExpanded(false)
      })
      expect(result.current.expanded).toBe(false)
    })

    it('should reset state set by useSetModelProviderListExpanded via useResetModelProviderListExpanded', () => {
      const { result } = renderHook(
        () => ({
          expanded: useModelProviderListExpanded('openai'),
          setExpanded: useSetModelProviderListExpanded('openai'),
          reset: useResetModelProviderListExpanded(),
        }),
        { wrapper },
      )

      act(() => {
        result.current.setExpanded(true)
      })
      act(() => {
        result.current.reset()
      })

      expect(result.current.expanded).toBe(false)
    })
  })

  // selectAtom granularity: changing one provider should not affect unrelated reads
  describe('selectAtom granularity', () => {
    it('should not cause unrelated provider reads to change when one provider is toggled', () => {
      const { result } = renderHook(
        () => ({
          openai: useModelProviderListExpanded('openai'),
          anthropic: useModelProviderListExpanded('anthropic'),
          google: useModelProviderListExpanded('google'),
          setOpenai: useSetModelProviderListExpanded('openai'),
        }),
        { wrapper },
      )

      const anthropicBefore = result.current.anthropic
      const googleBefore = result.current.google

      act(() => {
        result.current.setOpenai(true)
      })

      expect(result.current.openai).toBe(true)
      expect(result.current.anthropic).toBe(anthropicBefore)
      expect(result.current.google).toBe(googleBefore)
    })

    it('should keep individual provider states independent across multiple expansions and collapses', () => {
      const { result } = renderHook(
        () => ({
          openai: useModelProviderListExpanded('openai'),
          anthropic: useModelProviderListExpanded('anthropic'),
          setOpenai: useSetModelProviderListExpanded('openai'),
          setAnthropic: useSetModelProviderListExpanded('anthropic'),
        }),
        { wrapper },
      )

      act(() => {
        result.current.setOpenai(true)
      })
      act(() => {
        result.current.setAnthropic(true)
      })
      act(() => {
        result.current.setOpenai(false)
      })

      expect(result.current.openai).toBe(false)
      expect(result.current.anthropic).toBe(true)
    })
  })

  // Isolation: separate Provider instances have independent state
  describe('Provider isolation', () => {
    it('should have independent state across different Provider instances', () => {
      const wrapper1 = createWrapper()
      const wrapper2 = createWrapper()

      const { result: result1 } = renderHook(
        () => ({
          expanded: useModelProviderListExpanded('openai'),
          setExpanded: useSetModelProviderListExpanded('openai'),
        }),
        { wrapper: wrapper1 },
      )

      const { result: result2 } = renderHook(
        () => useModelProviderListExpanded('openai'),
        { wrapper: wrapper2 },
      )

      act(() => {
        result1.current.setExpanded(true)
      })

      expect(result1.current.expanded).toBe(true)
      expect(result2.current).toBe(false)
    })
  })
})
