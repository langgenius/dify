import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { Provider } from 'jotai'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  useExpandModelProviderList,
  useModelProviderListExpanded,
  useSetModelProviderListExpanded,
} from '../atoms'

const createWrapper = () => {
  return ({ children }: { children: ReactNode }) => <Provider>{children}</Provider>
}

describe('atoms', () => {
  let wrapper: ReturnType<typeof createWrapper>

  beforeEach(() => {
    wrapper = createWrapper()
  })

  describe('useExpandModelProviderList', () => {
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
  })

  describe('Cross-hook interaction', () => {
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
  })

  describe('selectAtom granularity', () => {
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

      const { result: result2 } = renderHook(() => useModelProviderListExpanded('openai'), {
        wrapper: wrapper2,
      })

      act(() => {
        result1.current.setExpanded(true)
      })

      expect(result1.current.expanded).toBe(true)
      expect(result2.current).toBe(false)
    })
  })
})
