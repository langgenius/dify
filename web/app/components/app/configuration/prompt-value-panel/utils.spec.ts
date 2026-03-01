import type { PromptVariable } from '@/models/debug'

import { describe, expect, it } from 'vitest'
import { replaceStringWithValues } from './utils'

const promptVariables: PromptVariable[] = [
  { key: 'user', name: 'User', type: 'string' },
  { key: 'topic', name: 'Topic', type: 'string' },
]

describe('replaceStringWithValues', () => {
  it('should replace placeholders when inputs have values', () => {
    const template = 'Hello {{user}} talking about {{topic}}'
    const result = replaceStringWithValues(template, promptVariables, { user: 'Alice', topic: 'cats' })
    expect(result).toBe('Hello Alice talking about cats')
  })

  it('should use prompt variable name when value is missing', () => {
    const template = 'Hi {{user}} from {{topic}}'
    const result = replaceStringWithValues(template, promptVariables, {})
    expect(result).toBe('Hi {{User}} from {{Topic}}')
  })

  it('should leave placeholder untouched when no variable is defined', () => {
    const template = 'Unknown {{missing}} placeholder'
    const result = replaceStringWithValues(template, promptVariables, {})
    expect(result).toBe('Unknown {{missing}} placeholder')
  })
})
