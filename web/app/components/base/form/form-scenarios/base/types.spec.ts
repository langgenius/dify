import { BaseFieldType } from './types'

describe('base scenario types', () => {
  it('should include all supported base field types', () => {
    expect(Object.values(BaseFieldType)).toEqual([
      'text-input',
      'paragraph',
      'number-input',
      'checkbox',
      'select',
      'file',
      'file-list',
    ])
  })
})
