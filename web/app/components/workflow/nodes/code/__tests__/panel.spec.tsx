import type { ReactNode } from 'react'
import type { CodeNodeType } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderNodePanel } from '../../__tests__/render-node-panel'
import Panel from '../panel'
import { CodeLanguage } from '../types'

const generatedCode = 'function main(foo, newParam) { return { result: foo } }'

// The editor owns Monaco and code generation; the panel owns parsing generated code.
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: (props: {
    readOnly: boolean
    value: string
    onChange: (value: string) => void
    onGenerated: (value: string) => void
    title: ReactNode
  }) => (
    <div>
      {props.title}
      <textarea
        aria-label="Code"
        readOnly={props.readOnly}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button
        type="button"
        disabled={props.readOnly}
        onClick={() => props.onGenerated(generatedCode)}
      >
        Generate code
      </button>
    </div>
  ),
}))

// Upstream variable browsing is a separate graph interaction; use the real input/output lists.
vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: () => <span>Upstream variable</span>,
}))

const createData = (overrides: Partial<CodeNodeType> = {}): CodeNodeType => ({
  title: 'Code',
  desc: '',
  type: BlockEnum.Code,
  code_language: CodeLanguage.javascript,
  code: 'function main(foo) { return { result: foo } }',
  variables: [{ variable: 'foo', value_selector: ['start', 'foo'], value_type: VarType.string }],
  outputs: { result: { type: VarType.string, children: null } },
  ...overrides,
})

const renderPanel = (data = createData(), readOnly = false) =>
  renderNodePanel(Panel, data, {
    initialStoreState: { canvasReadOnly: readOnly },
  })

describe('code panel', () => {
  it('adds inputs and outputs, synchronizes the signature, and removes outputs by row index', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel()
    await user.click(
      screen.getByRole('button', { name: 'common.operation.add workflow.nodes.code.inputVars' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.code.syncFunctionSignature' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'common.operation.add workflow.nodes.code.outputVars' }),
    )
    expect(data().variables).toEqual([
      createData().variables[0],
      { variable: '', value_selector: [] },
    ])
    expect(data().code).toBe('function main({foo, }) { return { result: foo } }')
    expect(data().outputs).toEqual({
      result: { type: VarType.string, children: null },
      var_2: { type: VarType.string, children: null },
    })
    await user.click(screen.getAllByRole('button', { name: /operation.remove/ })[0]!)
    await user.click(screen.getAllByRole('button', { name: /operation.remove/ })[1]!)
    expect(data().variables).toEqual([{ variable: '', value_selector: [] }])
    expect(data().outputs).toEqual({ var_2: { type: VarType.string, children: null } })
  })

  it('changes the output type through the real type picker', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel()
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'number' }))
    expect(data().outputs).toEqual({
      result: { type: VarType.number, children: null },
    })
  })

  it('parses generated code while retaining bindings for surviving parameters', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel(
      createData({
        variables: [
          { variable: 'foo', value_selector: ['start', 'foo'], value_type: VarType.string },
          { variable: 'removed', value_selector: ['start', 'removed'] },
        ],
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Generate code' }))
    expect(data()).toMatchObject({
      code: generatedCode,
      variables: [
        { variable: 'foo', value_selector: ['start', 'foo'], value_type: VarType.string },
        { variable: 'newParam', value_selector: [] },
      ],
      outputs: { result: { type: VarType.string, children: null } },
    })
  })

  it('prevents adding outputs or changing the language and variable names while readonly', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel(createData(), true)
    expect(screen.queryByRole('button', { name: /operation.add/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /syncFunctionSignature/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /operation.remove/ })).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('foo')).toBeDisabled()
    expect(screen.getByDisplayValue('result')).toHaveAttribute('readonly')
    await user.type(screen.getByDisplayValue('result'), 'changed')
    await user.click(screen.getByText('JavaScript'))
    expect(screen.queryByText('Python3')).not.toBeInTheDocument()
    expect(data()).toMatchObject(createData())
  })

  it.each(['confirm', 'cancel'] as const)(
    'handles removal %s through the real confirmation dialog',
    async (action) => {
      const user = userEvent.setup()
      const initial = createData()
      const consumer = createNode({
        id: 'consumer',
        data: {
          type: BlockEnum.TemplateTransform,
          variables: [{ variable: 'value', value_selector: ['node', 'result'] }],
          template: '{{ value }}',
        },
      })
      const { data, getNode } = renderNodePanel(Panel, initial, {
        nodes: [createNode({ id: 'node', data: initial }), consumer],
        edges: [createEdge({ source: 'node', target: 'consumer' })],
      })
      await user.click(screen.getAllByRole('button', { name: /operation.remove/ })[1]!)
      expect(data().outputs).toEqual(initial.outputs)
      await user.click(screen.getByRole('button', { name: `common.operation.${action}` }))
      expect(data().outputs).toEqual(action === 'confirm' ? {} : initial.outputs)
      expect(getNode('consumer')?.data.variables).toEqual([
        { variable: 'value', value_selector: action === 'confirm' ? [] : ['node', 'result'] },
      ])
      expect(
        screen.queryByRole('button', { name: 'common.operation.confirm' }),
      ).not.toBeInTheDocument()
    },
  )
})
