import { FormItemValidateStatusEnum, FormTypeEnum } from './types'

describe('form types', () => {
  it('should expose expected form type values', () => {
    expect(Object.values(FormTypeEnum)).toContain('text-input')
    expect(Object.values(FormTypeEnum)).toContain('dynamic-select')
    expect(Object.values(FormTypeEnum)).toContain('boolean')
  })

  it('should expose expected validation status values', () => {
    expect(Object.values(FormItemValidateStatusEnum)).toEqual([
      'success',
      'warning',
      'error',
      'validating',
    ])
  })
})
