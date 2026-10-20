import { describe, expect, it } from 'vite-plus/test'
import { VarType } from '@/app/components/workflow/types'
import { isSupportedHttpBodyVariable } from './supported-body-vars'

describe('HTTP body variable support', () => {
  it('should accept object and array object variables', () => {
    expect(isSupportedHttpBodyVariable(VarType.object)).toBe(true)
    expect(isSupportedHttpBodyVariable(VarType.arrayObject)).toBe(true)
  })

  it('should keep unsupported file variables excluded', () => {
    expect(isSupportedHttpBodyVariable(VarType.file)).toBe(false)
    expect(isSupportedHttpBodyVariable(VarType.arrayFile)).toBe(false)
  })
})
