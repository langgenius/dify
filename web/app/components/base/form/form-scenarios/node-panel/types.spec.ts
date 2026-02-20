import { InputFieldType } from './types'

describe('node-panel scenario types', () => {
  it('should include variableOrConstant field type', () => {
    expect(Object.values(InputFieldType)).toContain('variableOrConstant')
  })
})
