import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import MixedVariableTextInput from '../index'

const nodes = [
  createNode({ id: 'start-node', data: { type: BlockEnum.Start, title: 'Inputs' } }),
  createNode({ id: 'tool-node', data: { type: BlockEnum.Tool, title: 'Search Tool' } }),
]
const variables = [
  {
    nodeId: 'tool-node',
    title: 'Search Tool',
    vars: [{ variable: 'result', type: VarType.string }],
  },
]
function render(ui: React.ReactElement) {
  const { queryClient } = createConsoleQueryWrapper()
  seedAppDslVersion(queryClient)
  seedModelProviderQueries(queryClient, [])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  return renderWorkflowFlowComponent(ui, { queryClient, nodes })
}

it('resolves stored variable references to their workflow node titles', async () => {
  render(
    <MixedVariableTextInput
      value="{{#tool-node.result#}} {{#sys.query#}}"
      availableNodes={nodes}
      nodesOutputVars={variables}
    />,
  )
  const editor = screen.getByRole('textbox')
  expect(await within(editor).findByText('Search Tool')).toBeVisible()
  expect(within(editor).getByText('result')).toBeVisible()
  expect(within(editor).getByText('workflow.blocks.start')).toBeVisible()
  expect(within(editor).getByText('query')).toBeVisible()
})

it('inserts an available workflow variable through the editor picker', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <MixedVariableTextInput
      onChange={onChange}
      value="Enter "
      availableNodes={nodes}
      nodesOutputVars={variables}
    />,
  )
  await user.type(screen.getByRole('textbox'), '/')
  await user.click(await screen.findByText('result'))
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('Enter {{#tool-node.result#}}'))
  expect(within(screen.getByRole('textbox')).getByText('Search Tool')).toBeVisible()
})

it('keeps plain text editable when variable insertion is disabled', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <MixedVariableTextInput
      disableVariableInsertion
      onChange={onChange}
      value="Enter "
      availableNodes={nodes}
      nodesOutputVars={variables}
    />,
  )
  await user.type(screen.getByRole('textbox'), '/plain')
  expect(onChange).toHaveBeenLastCalledWith('Enter /plain')
  expect(screen.queryByText('result')).not.toBeInTheDocument()
})

it('preserves read-only text when the user types', async () => {
  const user = userEvent.setup()
  render(<MixedVariableTextInput readOnly value="Saved text" />)
  const editor = screen.getByRole('textbox')
  await waitFor(() => expect(editor).toHaveTextContent('Saved text'))
  expect(editor).toHaveAttribute('contenteditable', 'false')
  await user.type(editor, 'replacement')
  expect(editor.textContent).toBe('Saved text')
})
