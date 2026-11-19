import type { ComponentProps } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createNode, resetFixtureCounters } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { AssignerNodeInputType, WriteMode } from '../../../types'
import VarList from '../index'

vi.mock('../../../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../hooks/use-workflow')>()

  return {
    ...actual,

    useWorkflow: () => ({
      getTreeLeafNodes: () => [],
      getNodeById: () => undefined,
      getBeforeNodesInSameBranchIncludeParent: () => [],
    }),
  }
})

vi.mock('../../../../../hooks/use-workflow-variables', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../../hooks/use-workflow-variables')>()

  return {
    ...actual,
    useWorkflowVariables: () => ({
      getNodeAvailableVars: () => [],
      getCurrentVariableType: () => undefined,
    }),
  }
})

const sourceNode = createNode({
  id: 'node-a',
  data: {
    type: BlockEnum.Answer,
    title: 'Answer Node',
    outputs: {
      answer: { type: VarType.string },
      flag: { type: VarType.boolean },
    },
  },
})

const currentNode = createNode({
  id: 'node-current',
  data: {
    type: BlockEnum.VariableAssigner,
    title: 'Assigner Node',
  },
})

const createOperation = (
  overrides: Partial<ComponentProps<typeof VarList>['list'][number]> = {},
) => ({
  variable_selector: ['node-a', 'flag'],
  input_type: AssignerNodeInputType.variable,
  operation: WriteMode.overwrite,
  value: ['node-a', 'answer'],
  ...overrides,
})

const renderVarList = (props: Partial<ComponentProps<typeof VarList>> = {}) => {
  const handleChange = vi.fn()
  const handleOpen = vi.fn()

  function Harness() {
    const [list, setList] = useState(props.list ?? [])
    return (
      <VarList
        readonly={false}
        nodeId="node-current"
        onOpen={handleOpen}
        getAssignedVarType={() => VarType.string}
        getToAssignedVarType={() => VarType.string}
        writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
        writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
        writeModeTypesNum={[WriteMode.increment]}
        {...props}
        list={list}
        onChange={(next) => {
          setList(next)
          handleChange(next)
        }}
      />
    )
  }
  const result = renderWorkflowFlowComponent(<Harness />, {
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    nodes: [sourceNode, currentNode],
    edges: [],
    hooksStoreProps: {},
  })

  return {
    ...result,
    handleChange,
    handleOpen,
  }
}

describe('assigner/var-list', () => {
  beforeEach(() => {
    resetFixtureCounters()
  })

  it('switches a boolean assignment to constant mode and updates the selected value', async () => {
    const user = userEvent.setup()
    const list = [createOperation()]
    const { handleChange } = renderVarList({
      list,
      getAssignedVarType: () => VarType.boolean,
      getToAssignedVarType: () => VarType.boolean,
    })

    await user.click(screen.getByText('workflowLogic.nodes.assigner.operations.over-write'))
    await user.click(screen.getAllByText('workflowLogic.nodes.assigner.operations.set').at(-1)!)

    expect(handleChange.mock.lastCall?.[0]).toEqual([
      createOperation({
        operation: WriteMode.set,
        input_type: AssignerNodeInputType.constant,
        value: false,
      }),
    ])

    await user.click(screen.getByText('True'))

    expect(handleChange.mock.lastCall?.[0]).toEqual([
      createOperation({
        operation: WriteMode.set,
        input_type: AssignerNodeInputType.constant,
        value: true,
      }),
    ])
  })

  it('opens the assigned-variable picker and removes an operation', async () => {
    const user = userEvent.setup()
    const { handleChange, handleOpen } = renderVarList({
      list: [createOperation()],
    })

    await user.click(screen.getAllByTestId('var-reference-picker-trigger')[0]!)
    expect(handleOpen).toHaveBeenCalledWith(0)

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))

    expect(handleChange).toHaveBeenLastCalledWith([])
    expect(screen.getByText('workflowLogic.nodes.assigner.noVarTip')).toBeVisible()
  })
})
