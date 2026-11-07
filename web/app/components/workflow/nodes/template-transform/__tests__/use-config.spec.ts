import type { TemplateTransformNodeType } from '../types'
import type { Variable } from '@/app/components/workflow/types'
import { waitFor } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import useConfig from '../use-config'

const createVariable = (overrides: Partial<Variable> = {}): Variable => ({
  variable: 'input_text',
  value_selector: ['node-1', 'input_text'],
  value_type: VarType.string,
  ...overrides,
})

const createData = (
  overrides: Partial<TemplateTransformNodeType> = {},
): TemplateTransformNodeType => ({
  title: 'Template Transform',
  desc: '',
  type: BlockEnum.TemplateTransform,
  variables: [createVariable()],
  template: '{{ input_text }}',
  ...overrides,
})

describe('template-transform/use-config', () => {
  it('hydrates an empty template and variable bindings from node defaults', async () => {
    const defaults = createData({
      template: '{{ default_input }}',
      variables: [createVariable({ variable: 'default_input' })],
    })
    const { result } = renderNodeConfig(useConfig, createData({ template: '', variables: [] }), {
      initialStoreState: { nodesDefaultConfigs: { [BlockEnum.TemplateTransform]: defaults } },
    })
    await waitFor(() =>
      expect(result.current.flow.getNode('node')?.data).toMatchObject({
        template: defaults.template,
        variables: defaults.variables,
      }),
    )
  })
  it('accepts scalar and collection values but rejects files for interpolation', () => {
    const { result } = renderNodeConfig(useConfig, createData())
    for (const type of [VarType.string, VarType.arrayObject])
      expect(result.current.config.filterVar({ variable: 'value', type })).toBe(true)
    expect(result.current.config.filterVar({ variable: 'file', type: VarType.file })).toBe(false)
  })
})
