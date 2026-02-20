import { InputFieldType } from './types'

describe('input-field scenario types', () => {
  it('should include expected input field types', () => {
    expect(Object.values(InputFieldType)).toEqual([
      'textInput',
      'numberInput',
      'numberSlider',
      'checkbox',
      'options',
      'select',
      'inputTypeSelect',
      'uploadMethod',
      'fileTypes',
    ])
  })
})
