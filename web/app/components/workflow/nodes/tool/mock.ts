import type { ToolNodeType } from './types'
import { VarType } from './types'

export const mockData: ToolNodeType = {
  title: 'Test',
  desc: 'Test',
  type: 'Test',
  provider_id: 'test',
  provider_type: 'builtin',
  provider_name: 'test',
  tool_name: 'test',
  tool_label: 'test',
  tool_inputs: [
    {
      variable: 'size',
      variable_type: VarType.selector,
      value_selector: ['aaa', 'name'],
    },
    {
      variable: 'quality',
      variable_type: VarType.static,
      value: 'HD',
    },
  ],
  tool_parameters: {},
}
