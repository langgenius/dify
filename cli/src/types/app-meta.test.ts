import type { AppDescribeResponse } from '@dify/contracts/api/openapi/types.gen'
import { describe, expect, it } from 'vitest'
import { covers, FieldInfo, FieldInputSchema, FieldParameters, fromDescribe, mergeMeta } from './app-meta'

function describeResp(): AppDescribeResponse {
  return {
    info: {
      id: 'app-1',
      name: 'Greeter',
      description: '',
      mode: 'chat',
      updated_at: undefined,
      service_api_enabled: false,
      is_agent: false,
    },
    parameters: { opening_statement: 'hi' },
    input_schema: undefined,
  }
}

describe('app-meta', () => {
  it('fromDescribe with requested=[info] only marks info covered', () => {
    const m = fromDescribe(describeResp(), [FieldInfo])
    expect(m.coveredFields.has(FieldInfo)).toBe(true)
    expect(m.coveredFields.has(FieldParameters)).toBe(false)
    expect(covers(m, [FieldInfo])).toBe(true)
    expect(covers(m, [FieldParameters])).toBe(false)
  })

  it('fromDescribe with no fields marks all covered', () => {
    const m = fromDescribe(describeResp(), [])
    expect(m.coveredFields.has(FieldInfo)).toBe(true)
    expect(m.coveredFields.has(FieldParameters)).toBe(true)
    expect(m.coveredFields.has(FieldInputSchema)).toBe(true)
    expect(covers(m, [])).toBe(true)
  })

  it('mergeMeta unions covered fields and prefers next for covered keys', () => {
    const slim = fromDescribe(describeResp(), [FieldInfo])
    const full = fromDescribe(describeResp(), [FieldInfo, FieldParameters, FieldInputSchema])
    const merged = mergeMeta(slim, full)
    expect(covers(merged, [FieldInfo, FieldParameters, FieldInputSchema])).toBe(true)
  })

  it('mergeMeta with prev=undefined returns next', () => {
    const next = fromDescribe(describeResp(), [FieldInfo])
    expect(mergeMeta(undefined, next)).toBe(next)
  })

  it('covers([]) requires all three slots populated', () => {
    const partial = fromDescribe(describeResp(), [FieldInfo, FieldParameters])
    expect(covers(partial, [])).toBe(false)
  })
})
