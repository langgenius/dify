import type { StartNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { renderWorkflowFlowComponent } from '../../../__tests__/workflow-test-env'
import { BlockEnum, InputVarType } from '../../../types'
import Panel from '../panel'

function StartPanelOwner() {
  const node = useNodes<StartNodeType>().find((node) => node.id === 'start-node')
  if (!node) return null
  return (
    <>
      <Panel id={node.id} data={node.data} panelProps={{} as PanelProps} />
      <output aria-label="Start fields">{JSON.stringify(node.data.variables)}</output>
    </>
  )
}

const initialData: StartNodeType = {
  type: BlockEnum.Start,
  title: 'Start',
  desc: '',
  variables: [
    {
      variable: 'query',
      label: 'Query',
      type: InputVarType.textInput,
      required: false,
      max_length: 48,
    },
  ],
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('/default-model?')) return Response.json({ data: null })
    if (
      url.includes('/spec/schema-definitions') ||
      /\/tools\/(?:builtin|api|workflow|mcp)$/.test(url)
    )
      return Response.json([])
    if (url.includes('/variables')) return Response.json({ data: [] })
    throw new Error(`Unexpected request: ${url}`)
  })
})
afterEach(() => vi.restoreAllMocks())

function renderPanel(readOnly = false) {
  return renderWorkflowFlowComponent(<StartPanelOwner />, {
    nodes: [{ id: 'start-node', position: { x: 0, y: 0 }, data: initialData }],
    edges: [],
    initialStoreState: { canvasReadOnly: readOnly },
    hooksStoreProps: { doSyncWorkflowDraft: vi.fn() },
  })
}

it('keeps duplicate input open, then accepts the field into the actual Start node and closes', async () => {
  const user = userEvent.setup()
  renderPanel()
  await user.click(
    screen.getByRole('button', { name: 'common.operation.add workflow.nodes.start.inputField' }),
  )
  const variable = screen.getByRole('textbox', { name: 'appDebug.variableConfig.varName' })
  const label = screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })
  await user.type(variable, 'query')
  await user.clear(label)
  await user.type(label, 'Another label')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(JSON.parse(screen.getByLabelText('Start fields').textContent!)).toHaveLength(1)
  await user.clear(variable)
  await user.type(variable, 'locale')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(JSON.parse(screen.getByLabelText('Start fields').textContent!)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ variable: 'locale', label: 'Another label' }),
    ]),
  )
})

it('does not expose input mutation entries when the actual Start node is readonly', () => {
  renderPanel(true)
  expect(
    screen.queryByRole('button', { name: 'common.operation.add workflow.nodes.start.inputField' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
})
