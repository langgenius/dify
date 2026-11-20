import { describe, expect, it } from 'vite-plus/test'
import { VarType } from '@/app/components/workflow/types'
import { isTextVarType } from '../text-var-types'

describe('isTextVarType', () => {
  it('should accept every type that interpolates as plain text', () => {
    expect(isTextVarType(VarType.string)).toBe(true)
    expect(isTextVarType(VarType.number)).toBe(true)
    expect(isTextVarType(VarType.integer)).toBe(true)
    expect(isTextVarType(VarType.secret)).toBe(true)
  })

  it('should keep structured types out of text fields', () => {
    expect(isTextVarType(VarType.object)).toBe(false)
    expect(isTextVarType(VarType.array)).toBe(false)
    expect(isTextVarType(VarType.arrayString)).toBe(false)
    expect(isTextVarType(VarType.arrayNumber)).toBe(false)
    expect(isTextVarType(VarType.boolean)).toBe(false)
    expect(isTextVarType(VarType.file)).toBe(false)
    expect(isTextVarType(VarType.arrayFile)).toBe(false)
  })
})
