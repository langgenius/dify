import type { TemplateTransformNodeType } from '../types'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { BlockEnum, VarType } from '../../../types'
import Panel from '../panel'

// Only the external Monaco runtime is replaced; Dify's editor wrappers remain real.
vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
    options,
  }: {
    value: string
    onChange: (value: string) => void
    options: { readOnly?: boolean }
  }) => (
    <textarea
      aria-label="Template editor"
      value={value}
      readOnly={options.readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  loader: { config: vi.fn() },
}))

const payload: TemplateTransformNodeType = {
  title: 'Template',
  desc: '',
  type: BlockEnum.TemplateTransform,
  variables: [
    {
      variable: 'input_text',
      value_selector: ['source', 'input_text'],
      value_type: VarType.string,
    },
  ],
  template: '{{ input_text }}',
}
const panelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}
const ConnectedPanel = () => {
  const nodes = useNodes<TemplateTransformNodeType>()
  return (
    <Panel
      id="template"
      data={nodes.find((node) => node.id === 'template')?.data ?? payload}
      panelProps={panelProps}
    />
  )
}
const setup = (readOnly = false) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return renderWorkflowFlowComponent(<ConnectedPanel />, {
    queryClient,
    initialStoreState: { canvasReadOnly: readOnly },
    nodes: [
      createNode({ id: 'template', data: payload }),
      createNode({
        id: 'source',
        data: { type: BlockEnum.Code, outputs: { input_text: { type: VarType.string } } },
      }),
    ],
    edges: [createEdge({ source: 'source', target: 'template' })],
  })
}

it('renames real input variables and keeps the template synchronized through subsequent edits', async () => {
  const user = userEvent.setup()
  setup()
  const variable = screen.getByRole('textbox', { name: 'workflow.common.variableNamePlaceholder' })
  // One change event represents replacing the selected identifier, preserving a valid name throughout.
  fireEvent.change(variable, { target: { value: 'renamed_input' } })
  expect(screen.getByRole('textbox', { name: 'Template editor' })).toHaveValue(
    '{{ renamed_input }}',
  )
  await user.click(
    screen.getByRole('button', {
      name: 'common.operation.add workflow.nodes.templateTransform.inputVars',
    }),
  )
  expect(
    screen.getAllByRole('textbox', { name: 'workflow.common.variableNamePlaceholder' }),
  ).toHaveLength(2)
  expect(variable).toHaveValue('renamed_input')
  expect(screen.getByRole('textbox', { name: 'Template editor' })).toHaveValue(
    '{{ renamed_input }}',
  )
  expect(
    screen.getByRole('link', { name: /workflow.nodes.templateTransform.codeSupportTip/i }),
  ).toHaveAttribute('href', 'https://jinja.palletsprojects.com/en/3.1.x/templates/')
})

it('keeps both variable names and the template readonly when editing is denied', async () => {
  const user = userEvent.setup()
  setup(true)
  await user.type(screen.getByRole('textbox', { name: 'Template editor' }), 'changed')
  expect(screen.getByRole('textbox', { name: 'Template editor' })).toHaveValue(payload.template)
  expect(
    screen.queryByRole('button', {
      name: 'common.operation.add workflow.nodes.templateTransform.inputVars',
    }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Template editor' })).toHaveAttribute('readonly')
  expect(
    screen.getByRole('textbox', { name: 'workflow.common.variableNamePlaceholder' }),
  ).toBeDisabled()
})
