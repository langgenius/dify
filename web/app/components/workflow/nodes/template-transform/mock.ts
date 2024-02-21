import type { TemplateTransformNodeType } from './types'

export const mockData: TemplateTransformNodeType = {
  title: 'Test',
  desc: 'Test',
  type: 'Test',
  variables: [
    {
      variable: 'name',
      value_selector: ['aaa', 'name'],
    },
    {
      variable: 'age',
      value_selector: ['bbb', 'b', 'c'],
    },
  ],
  template: 'print("hello world")',
}
