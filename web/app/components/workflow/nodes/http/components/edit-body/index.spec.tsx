import { describe, expect, it } from 'vitest'
import { VarType } from '@/app/components/workflow/types'
import {
  HTTP_BODY_VARIABLE_TYPES,
  isSupportedHttpBodyVariable,
} from './supported-body-vars'

describe('HTTP body variable support', () => {
  it('should include structured variables in the selector', () => {
    expect(HTTP_BODY_VARIABLE_TYPES).toEqual([
      VarType.string,
      VarType.number,
      VarType.secret,
      VarType.object,
      VarType.arrayNumber,
      VarType.arrayString,
      VarType.arrayObject,
    ])
  })

  it('should accept object and array object variables', () => {
    expect(isSupportedHttpBodyVariable(VarType.object)).toBe(true)
    expect(isSupportedHttpBodyVariable(VarType.arrayObject)).toBe(true)
  })

  it('should keep unsupported file variables excluded', () => {
    expect(isSupportedHttpBodyVariable(VarType.file)).toBe(false)
    expect(isSupportedHttpBodyVariable(VarType.arrayFile)).toBe(false)
  })
})
