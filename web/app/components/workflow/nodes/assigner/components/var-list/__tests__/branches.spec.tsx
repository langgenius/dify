import type { ComponentProps } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { AssignerNodeInputType, WriteMode } from '../../../types'
import VarList from '../index'

type Operation = ComponentProps<typeof VarList>['list'][number]
const createOperation = (overrides: Partial<Operation> = {}): Operation => ({
  variable_selector: ['conversation', 'flag'],
  input_type: AssignerNodeInputType.variable,
  operation: WriteMode.overwrite,
  value: ['producer', 'answer'],
  ...overrides,
})

function ControlledList({ initialList }: { initialList: Operation[] }) {
  const [list, setList] = useState(initialList)
  const [opened, setOpened] = useState<number>()
  return (
    <>
      <VarList
        readonly={false}
        nodeId="node-current"
        list={list}
        onChange={setList}
        onOpen={setOpened}
        filterVar={(_variable, selector) => selector[0] === 'conversation'}
        getAssignedVarType={(selector) =>
          selector[1] === 'count' ? VarType.number : VarType.string
        }
        getToAssignedVarType={(type) => type}
        writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
        writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
        writeModeTypesNum={[WriteMode.increment]}
      />
      <output aria-label="Assignments">{JSON.stringify(list)}</output>
      <output aria-label="Editing assignment">{opened}</output>
    </>
  )
}

function renderVarList(initialList: Operation[]) {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedModelProviderQueries(queryClient, [])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const producer = createNode({
    id: 'producer',
    data: {
      type: BlockEnum.Code,
      title: 'Answer source',
      outputs: { answer: { type: VarType.string, children: null } },
    },
  })
  const assigner = createNode({
    id: 'node-current',
    data: { type: BlockEnum.Assigner, title: 'Assign' },
  })
  return renderWorkflowFlowComponent(<ControlledList initialList={initialList} />, {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
    nodes: [producer, assigner],
    edges: [createEdge({ source: producer.id, target: assigner.id })],
    initialStoreState: {
      conversationVariables: [
        { id: 'flag', name: 'flag', value_type: ChatVarType.String, value: '', description: '' },
        { id: 'total', name: 'total', value_type: ChatVarType.String, value: '', description: '' },
        { id: 'count', name: 'count', value_type: ChatVarType.Number, value: 1, description: '' },
      ],
    },
  })
}

const assignments = () => JSON.parse(screen.getByLabelText('Assignments').textContent!)

describe('assigner/var-list branches', () => {
  it('resets stale constant metadata when selecting another destination, then assigns a graph output', async () => {
    const user = userEvent.setup()
    renderVarList([
      createOperation({
        operation: WriteMode.set,
        input_type: AssignerNodeInputType.constant,
        value: 'stale',
      }),
    ])
    await user.click(screen.getByText('flag'))
    expect(screen.getByLabelText('Editing assignment')).toHaveTextContent('0')
    await user.click(await screen.findByText('total'))
    expect(assignments()).toEqual([
      createOperation({ variable_selector: ['conversation', 'total'], value: undefined }),
    ])
    expect(screen.queryByRole('textbox', { name: 'conversation.flag' })).not.toBeInTheDocument()
    await user.click(screen.getByText('workflowLogic.nodes.assigner.setParameter'))
    await user.click(await screen.findByText('answer'))
    expect(assignments()).toEqual([
      createOperation({ variable_selector: ['conversation', 'total'] }),
    ])
  })

  it('clears constant input when switching to overwrite', async () => {
    const user = userEvent.setup()
    renderVarList([
      createOperation({
        operation: WriteMode.set,
        input_type: AssignerNodeInputType.constant,
        value: 'hello',
      }),
    ])
    await user.click(
      screen.getByRole('button', { name: 'workflowLogic.nodes.assigner.operations.set' }),
    )
    await user.click(
      await screen.findByRole('menuitemradio', {
        name: 'workflowLogic.nodes.assigner.operations.over-write',
      }),
    )
    expect(assignments()).toEqual([createOperation({ value: '' })])
    expect(screen.queryByRole('textbox', { name: 'conversation.flag' })).not.toBeInTheDocument()
    expect(screen.getByText('workflowLogic.nodes.assigner.setParameter')).toBeInTheDocument()
  })

  it('edits string and numeric constants without changing neighboring assignments', async () => {
    const user = userEvent.setup()
    const text = createOperation({
      operation: WriteMode.set,
      input_type: AssignerNodeInputType.constant,
      value: 'hello',
    })
    const number = createOperation({
      variable_selector: ['conversation', 'count'],
      operation: WriteMode.set,
      input_type: AssignerNodeInputType.constant,
      value: 1,
    })
    renderVarList([text, number])
    await user.clear(screen.getByRole('textbox', { name: 'conversation.flag' }))
    await user.type(screen.getByRole('textbox', { name: 'conversation.flag' }), 'updated')
    await user.clear(screen.getByRole('textbox', { name: 'conversation.count' }))
    await user.type(screen.getByRole('textbox', { name: 'conversation.count' }), '2')
    expect(assignments()).toEqual([
      { ...text, value: 'updated' },
      { ...number, value: 2 },
    ])
  })

  it('edits a numeric increment through the number field', async () => {
    const user = userEvent.setup()
    const operation = createOperation({
      variable_selector: ['conversation', 'count'],
      operation: WriteMode.increment,
      value: 2,
    })
    renderVarList([operation])
    await user.clear(screen.getByRole('textbox', { name: 'conversation.count' }))
    await user.type(screen.getByRole('textbox', { name: 'conversation.count' }), '5')
    expect(assignments()).toEqual([{ ...operation, value: 5 }])
  })
})
