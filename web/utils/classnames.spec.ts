/**
 * Test suite for the classnames utility function
 * This utility combines the classnames library with tailwind-merge
 * to handle conditional CSS classes and merge conflicting Tailwind classes
 */
import { cn } from './classnames'

describe('classnames', () => {
  /**
   * Tests basic classnames library features:
   * - String concatenation
   * - Array handling
   * - Falsy value filtering
   * - Object-based conditional classes
   */
  it('classnames libs feature', () => {
    expect(cn('foo')).toBe('foo')
    expect(cn('foo', 'bar')).toBe('foo bar')
    expect(cn(['foo', 'bar'])).toBe('foo bar')

    expect(cn(undefined)).toBe('')
    expect(cn(null)).toBe('')
    expect(cn(false)).toBe('')

    expect(cn({
      foo: true,
      bar: false,
      baz: true,
    })).toBe('foo baz')
  })

  /**
   * Tests tailwind-merge functionality:
   * - Conflicting class resolution (last one wins)
   * - Modifier handling (hover, focus, etc.)
   * - Important prefix (!)
   * - Custom color classes
   * - Arbitrary values
   */
  it('tailwind-merge', () => {
    /* eslint-disable tailwindcss/classnames-order */
    expect(cn('p-0')).toBe('p-0')
    expect(cn('text-right text-center text-left')).toBe('text-left')
    expect(cn('pl-4 p-8')).toBe('p-8')
    expect(cn('m-[2px] m-[4px]')).toBe('m-[4px]')
    expect(cn('m-1 m-[4px]')).toBe('m-[4px]')
    expect(cn('overflow-x-auto hover:overflow-x-hidden overflow-x-scroll')).toBe(
      'hover:overflow-x-hidden overflow-x-scroll',
    )
    expect(cn('h-10 h-min')).toBe('h-min')
    expect(cn('bg-grey-5 bg-hotpink')).toBe('bg-hotpink')

    expect(cn('hover:block hover:inline')).toBe('hover:inline')

    expect(cn('font-medium !font-bold')).toBe('font-medium !font-bold')
    expect(cn('!font-medium !font-bold')).toBe('!font-bold')

    expect(cn('text-gray-100 text-primary-200')).toBe('text-primary-200')
    expect(cn('text-some-unknown-color text-components-input-bg-disabled text-primary-200')).toBe('text-primary-200')
    expect(cn('bg-some-unknown-color bg-components-input-bg-disabled bg-primary-200')).toBe('bg-primary-200')

    expect(cn('border-t border-white/10')).toBe('border-t border-white/10')
    expect(cn('border-t border-white')).toBe('border-t border-white')
    expect(cn('text-3.5xl text-black')).toBe('text-3.5xl text-black')
  })

  /**
   * Tests the integration of classnames and tailwind-merge:
   * - Object-based conditional classes with Tailwind conflict resolution
   */
  it('classnames combined with tailwind-merge', () => {
    expect(cn('text-right', {
      'text-center': true,
    })).toBe('text-center')

    expect(cn('text-right', {
      'text-center': false,
    })).toBe('text-right')
  })

  /**
   * Tests handling of multiple mixed argument types:
   * - Strings, arrays, and objects in a single call
   * - Tailwind merge working across different argument types
   */
  it('multiple mixed argument types', () => {
    expect(cn('foo', ['bar', 'baz'], { qux: true, quux: false })).toBe('foo bar baz qux')
    expect(cn('p-4', ['p-2', 'm-4'], { 'text-left': true, 'text-right': true })).toBe('p-2 m-4 text-right')
  })

  /**
   * Tests nested array handling:
   * - Deep array flattening
   * - Tailwind merge with nested structures
   */
  it('nested arrays', () => {
    expect(cn(['foo', ['bar', 'baz']])).toBe('foo bar baz')
    expect(cn(['p-4', ['p-2', 'text-center']])).toBe('p-2 text-center')
  })

  /**
   * Tests empty input handling:
   * - Empty strings, arrays, and objects
   * - Mixed empty and non-empty values
   */
  it('empty inputs', () => {
    expect(cn('')).toBe('')
    expect(cn([])).toBe('')
    expect(cn({})).toBe('')
    expect(cn('', [], {})).toBe('')
    expect(cn('foo', '', 'bar')).toBe('foo bar')
  })

  /**
   * Tests number input handling:
   * - Truthy numbers converted to strings
   * - Zero treated as falsy
   */
  it('numbers as inputs', () => {
    expect(cn(1)).toBe('1')
    expect(cn(0)).toBe('')
    expect(cn('foo', 1, 'bar')).toBe('foo 1 bar')
  })

  /**
   * Tests multiple object arguments:
   * - Object merging
   * - Tailwind conflict resolution across objects
   */
  it('multiple objects', () => {
    expect(cn({ foo: true }, { bar: true })).toBe('foo bar')
    expect(cn({ foo: true, bar: false }, { bar: true, baz: true })).toBe('foo bar baz')
    expect(cn({ 'p-4': true }, { 'p-2': true })).toBe('p-2')
  })

  /**
   * Tests complex edge cases:
   * - Mixed falsy values
   * - Nested arrays with falsy values
   * - Multiple conflicting Tailwind classes
   */
  it('complex edge cases', () => {
    expect(cn('foo', null, undefined, false, 'bar', 0, 1, '')).toBe('foo bar 1')
    expect(cn(['foo', null, ['bar', undefined, 'baz']])).toBe('foo bar baz')
    expect(cn('text-sm', { 'text-lg': false, 'text-xl': true }, 'text-2xl')).toBe('text-2xl')
  })

  /**
   * Tests important (!) modifier behavior:
   * - Important modifiers in objects
   * - Conflict resolution with important prefix
   */
  it('important modifier with objects', () => {
    expect(cn({ '!font-medium': true }, { '!font-bold': true })).toBe('!font-bold')
    expect(cn('font-normal', { '!font-bold': true })).toBe('font-normal !font-bold')
  })
})
