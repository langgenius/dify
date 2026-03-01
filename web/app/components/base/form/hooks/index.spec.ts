import * as hookExports from './index'
import { useCheckValidated } from './use-check-validated'
import { useGetFormValues } from './use-get-form-values'
import { useGetValidators } from './use-get-validators'

describe('hooks index exports', () => {
  it('should re-export all hook modules', () => {
    expect(hookExports.useCheckValidated).toBe(useCheckValidated)
    expect(hookExports.useGetFormValues).toBe(useGetFormValues)
    expect(hookExports.useGetValidators).toBe(useGetValidators)
  })
})
