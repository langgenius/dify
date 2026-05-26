import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TERMINAL_WIDTH_FALLBACK, terminalWidth, truncate } from './width.js'

describe('truncate', () => {
  it('returns the input unchanged when shorter than max', () => {
    expect(truncate('hi', 5)).toBe('hi')
  })

  it('returns the input unchanged when exactly at max', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('truncates to max with single ellipsis char when longer', () => {
    expect(truncate('hello world', 5)).toBe('hell…')
  })

  it('returns empty for empty input regardless of max', () => {
    expect(truncate('', 5)).toBe('')
  })

  it('returns just the ellipsis when max is 1', () => {
    expect(truncate('hello', 1)).toBe('…')
  })

  it('returns empty when max is 0', () => {
    expect(truncate('hello', 0)).toBe('')
  })

  it('handles negative max gracefully', () => {
    expect(truncate('hello', -3)).toBe('')
  })
})

describe('terminalWidth', () => {
  let originalColumns: number | undefined

  beforeEach(() => {
    originalColumns = process.stdout.columns
  })

  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      configurable: true,
      writable: true,
    })
  })

  it('returns process.stdout.columns when present', () => {
    Object.defineProperty(process.stdout, 'columns', {
      value: 120,
      configurable: true,
      writable: true,
    })
    expect(terminalWidth()).toBe(120)
  })

  it('falls back to 80 when columns is undefined', () => {
    Object.defineProperty(process.stdout, 'columns', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    expect(terminalWidth()).toBe(TERMINAL_WIDTH_FALLBACK)
    expect(TERMINAL_WIDTH_FALLBACK).toBe(80)
  })

  it('falls back to 80 when columns is 0', () => {
    Object.defineProperty(process.stdout, 'columns', {
      value: 0,
      configurable: true,
      writable: true,
    })
    expect(terminalWidth()).toBe(TERMINAL_WIDTH_FALLBACK)
  })
})
