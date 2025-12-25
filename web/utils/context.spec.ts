import { renderHook } from '@testing-library/react'
/**
 * Test suite for React context creation utilities
 *
 * This module provides helper functions to create React contexts with better type safety
 * and automatic error handling when context is used outside of its provider.
 *
 * Two variants are provided:
 * - createCtx: Standard React context using useContext/createContext
 * - createSelectorCtx: Context with selector support using use-context-selector library
 */
import * as React from 'react'
import { createCtx, createSelectorCtx } from './context'

describe('Context Utilities', () => {
  describe('createCtx', () => {
    /**
     * Test that createCtx creates a valid context with provider and hook
     * The function should return a tuple with [Provider, useContextValue, Context]
     * plus named properties for easier access
     */
    it('should create context with provider and hook', () => {
      type TestContextValue = { value: string }
      const [Provider, useTestContext, Context] = createCtx<TestContextValue>({
        name: 'Test',
      })

      expect(Provider).toBeDefined()
      expect(useTestContext).toBeDefined()
      expect(Context).toBeDefined()
    })

    /**
     * Test that the context hook returns the provided value correctly
     * when used within the context provider
     */
    it('should provide and consume context value', () => {
      type TestContextValue = { value: string }
      const [Provider, useTestContext] = createCtx<TestContextValue>({
        name: 'Test',
      })

      const testValue = { value: 'test-value' }

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(Provider, { value: testValue }, children)

      const { result } = renderHook(() => useTestContext(), { wrapper })

      expect(result.current).toEqual(testValue)
    })

    /**
     * Test that accessing context outside of provider throws an error
     * This ensures developers are notified when they forget to wrap components
     */
    it('should throw error when used outside provider', () => {
      type TestContextValue = { value: string }
      const [, useTestContext] = createCtx<TestContextValue>({
        name: 'Test',
      })

      // Suppress console.error for this test
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { /* suppress error */ })

      expect(() => {
        renderHook(() => useTestContext())
      }).toThrow('No Test context found.')

      consoleError.mockRestore()
    })

    /**
     * Test that context works with default values
     * When a default value is provided, it should be accessible without a provider
     */
    it('should use default value when provided', () => {
      type TestContextValue = { value: string }
      const defaultValue = { value: 'default' }
      const [, useTestContext] = createCtx<TestContextValue>({
        name: 'Test',
        defaultValue,
      })

      const { result } = renderHook(() => useTestContext())

      expect(result.current).toEqual(defaultValue)
    })

    /**
     * Test that the returned tuple has named properties for convenience
     * This allows destructuring or property access based on preference
     */
    it('should expose named properties', () => {
      type TestContextValue = { value: string }
      const result = createCtx<TestContextValue>({ name: 'Test' })

      expect(result.provider).toBe(result[0])
      expect(result.useContextValue).toBe(result[1])
      expect(result.context).toBe(result[2])
    })

    /**
     * Test context with complex data types
     * Ensures type safety is maintained with nested objects and arrays
     */
    it('should handle complex context values', () => {
      type ComplexContext = {
        user: { id: string, name: string }
        settings: { theme: string, locale: string }
        actions: Array<() => void>
      }

      const [Provider, useComplexContext] = createCtx<ComplexContext>({
        name: 'Complex',
      })

      const complexValue: ComplexContext = {
        user: { id: '123', name: 'Test User' },
        settings: { theme: 'dark', locale: 'en-US' },
        actions: [
          () => { /* empty action 1 */ },
          () => { /* empty action 2 */ },
        ],
      }

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(Provider, { value: complexValue }, children)

      const { result } = renderHook(() => useComplexContext(), { wrapper })

      expect(result.current).toEqual(complexValue)
      expect(result.current.user.id).toBe('123')
      expect(result.current.settings.theme).toBe('dark')
      expect(result.current.actions).toHaveLength(2)
    })

    /**
     * Test that context updates propagate to consumers
     * When provider value changes, hooks should receive the new value
     */
    it('should update when context value changes', () => {
      type TestContextValue = { count: number }
      const [Provider, useTestContext] = createCtx<TestContextValue>({
        name: 'Test',
      })

      let value = { count: 0 }
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(Provider, { value }, children)

      const { result, rerender } = renderHook(() => useTestContext(), { wrapper })

      expect(result.current.count).toBe(0)

      value = { count: 5 }
      rerender()

      expect(result.current.count).toBe(5)
    })
  })

  describe('createSelectorCtx', () => {
    /**
     * Test that createSelectorCtx creates a valid context with selector support
     * This variant uses use-context-selector for optimized re-renders
     */
    it('should create selector context with provider and hook', () => {
      type TestContextValue = { value: string }
      const [Provider, useTestContext, Context] = createSelectorCtx<TestContextValue>({
        name: 'SelectorTest',
      })

      expect(Provider).toBeDefined()
      expect(useTestContext).toBeDefined()
      expect(Context).toBeDefined()
    })

    /**
     * Test that selector context provides and consumes values correctly
     * The API should be identical to createCtx for basic usage
     */
    it('should provide and consume context value with selector', () => {
      type TestContextValue = { value: string }
      const [Provider, useTestContext] = createSelectorCtx<TestContextValue>({
        name: 'SelectorTest',
      })

      const testValue = { value: 'selector-test' }

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(Provider, { value: testValue }, children)

      const { result } = renderHook(() => useTestContext(), { wrapper })

      expect(result.current).toEqual(testValue)
    })

    /**
     * Test error handling for selector context
     * Should throw error when used outside provider, same as createCtx
     */
    it('should throw error when used outside provider', () => {
      type TestContextValue = { value: string }
      const [, useTestContext] = createSelectorCtx<TestContextValue>({
        name: 'SelectorTest',
      })

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { /* suppress error */ })

      expect(() => {
        renderHook(() => useTestContext())
      }).toThrow('No SelectorTest context found.')

      consoleError.mockRestore()
    })

    /**
     * Test that selector context works with default values
     */
    it('should use default value when provided', () => {
      type TestContextValue = { value: string }
      const defaultValue = { value: 'selector-default' }
      const [, useTestContext] = createSelectorCtx<TestContextValue>({
        name: 'SelectorTest',
        defaultValue,
      })

      const { result } = renderHook(() => useTestContext())

      expect(result.current).toEqual(defaultValue)
    })
  })

  describe('Context without name', () => {
    /**
     * Test that contexts can be created without a name
     * The error message should use a generic fallback
     */
    it('should create context without name and show generic error', () => {
      type TestContextValue = { value: string }
      const [, useTestContext] = createCtx<TestContextValue>()

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { /* suppress error */ })

      expect(() => {
        renderHook(() => useTestContext())
      }).toThrow('No related context found.')

      consoleError.mockRestore()
    })
  })
})
