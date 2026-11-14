import type { StartNodeType } from '../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import Panel from '../panel'

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
}))

vi.mock('@/service/use-workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-workflow')>()),
  useConversationVarValues: () => ({ data: [] }),
  useSysVarValues: () => ({ data: [] }),
}))
const panelProps = {
  getInputVars: () => [],
  toVarInputs: () => [],
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: () => {},
  runResult: null,
}
function Editor() {
  const node = useNodes<StartNodeType>().find((node) => node.id === 'start')
  return node ? (
    <>
      <Panel id={node.id} data={node.data} panelProps={panelProps} />
      <output aria-label="Start variables">{JSON.stringify(node.data.variables)}</output>
    </>
  ) : null
}
const renderPanel = (variables: StartNodeType['variables'] = []) => {
  const { queryClient } = createConsoleQueryWrapper()
  void queryClient.query({
    queryKey: consoleQuery.files.upload.get.queryKey(),
    queryFn: () => new Promise(() => {}),
  })
  return renderWorkflowFlowComponent(<Editor />, {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
    nodes: [
      createNode({
        id: 'start',
        data: { type: BlockEnum.Start, title: 'Start', desc: '', variables },
      }),
    ],
  })
}

it('adds an input through the configuration dialog, persists it in the graph and closes the dialog', async () => {
  const user = userEvent.setup()
  renderPanel()
  expect(screen.getByText('userinput.query')).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'common.operation.add workflow.nodes.start.inputField' }),
  )
  await user.type(
    await screen.findByRole('textbox', { name: 'appDebug.variableConfig.varName' }),
    'locale',
  )
  const label = screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })
  await user.clear(label)
  await user.type(label, 'Locale')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('status', { name: 'Start variables' })).toHaveTextContent(
    '"variable":"locale"',
  )
  expect(screen.getByRole('status', { name: 'Start variables' })).toHaveTextContent(
    '"label":"Locale"',
  )
})

it('keeps duplicate variable input open for correction without changing the graph', async () => {
  const user = userEvent.setup()
  const variables = [
    { variable: 'locale', label: 'Locale', type: InputVarType.textInput, required: false },
  ]
  renderPanel(variables)
  await user.click(
    screen.getByRole('button', { name: 'common.operation.add workflow.nodes.start.inputField' }),
  )
  await user.type(
    await screen.findByRole('textbox', { name: 'appDebug.variableConfig.varName' }),
    'locale',
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(screen.getByLabelText('Start variables')).toHaveTextContent(JSON.stringify(variables))
})
