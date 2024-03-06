import { BlockEnum } from '../../types'
import type { TemplateTransformNodeType } from './types'

export const mockData: TemplateTransformNodeType = {
  title: 'Template Transform',
  desc: 'Test',
  type: BlockEnum.TemplateTransform,
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
