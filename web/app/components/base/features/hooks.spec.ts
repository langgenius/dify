import { renderHook } from '@testing-library/react'
import * as React from 'react'
import { FeaturesContext } from './context'
import { useFeatures, useFeaturesStore } from './hooks'
import { createFeaturesStore } from './store'

describe('useFeatures', () => {
  it('should return selected state from the store', () => {
    const store = createFeaturesStore({
      features: { moreLikeThis: { enabled: true } },
    })

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(FeaturesContext.Provider, { value: store }, children)

    const { result } = renderHook(
      () => useFeatures(s => s.features.moreLikeThis?.enabled),
      { wrapper },
    )

    expect(result.current).toBe(true)
  })

  it('should throw when used outside FeaturesContext.Provider', () => {
    expect(() => {
      renderHook(() => useFeatures(s => s.features))
    }).toThrow('Missing FeaturesContext.Provider in the tree')
  })
})

describe('useFeaturesStore', () => {
  it('should return the store from context', () => {
    const store = createFeaturesStore()

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(FeaturesContext.Provider, { value: store }, children)

    const { result } = renderHook(() => useFeaturesStore(), { wrapper })

    expect(result.current).toBe(store)
  })

  it('should return null when used outside provider', () => {
    const { result } = renderHook(() => useFeaturesStore())

    expect(result.current).toBeNull()
  })
})
