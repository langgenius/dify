import type { ComponentProps } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode, resetFixtureCounters } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { AssignerNodeInputType, WriteMode } from '../../../types'
import VarList from '../index'

vi.mock('@/app/components/workflow/hooks', () => ({
  useIsChatMode: () => false,
  useWorkflow: () => ({
    getTreeLeafNodes: () => [],
    getNodeById: () => undefined,
    getBeforeNodesInSameBranchIncludeParent: () => [],
  }),
  useWorkflowVariables: () => ({
    getNodeAvailableVars: () => [],
    getCurrentVariableType: () => undefined,
  }),
}))

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

const createOperation = (overrides: Partial<ComponentProps<typeof VarList>['list'][number]> = {}) => ({
  variable_selector: ['node-a', 'flag'],
  input_type: AssignerNodeInputType.variable,
  operation: WriteMode.overwrite,
  value: ['node-a', 'answer'],
  ...overrides,
})

const renderVarList = (props: Partial<ComponentProps<typeof VarList>> = {}) => {
  const handleChange = vi.fn()
  const handleOpen = vi.fn()

  const result = renderWorkflowFlowComponent(
    <VarList
      readonly={false}
      nodeId="node-current"
      list={[]}
      onChange={handleChange}
      onOpen={handleOpen}
      getAssignedVarType={() => VarType.string}
      getToAssignedVarType={() => VarType.string}
      writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
      writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
      writeModeTypesNum={[WriteMode.increment]}
      {...props}
    />,
    {
      nodes: [sourceNode, currentNode],
      edges: [],
      hooksStoreProps: {},
    },
  )

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

  it('renders the empty placeholder when no operations are configured', () => {
    renderVarList()

    expect(screen.getByText('workflow.nodes.assigner.noVarTip')).toBeInTheDocument()
  })

  it('switches a boolean assignment to constant mode and updates the selected value', async () => {
    const user = userEvent.setup()
    const list = [createOperation()]
    const { handleChange, rerender } = renderVarList({
      list,
      getAssignedVarType: () => VarType.boolean,
      getToAssignedVarType: () => VarType.boolean,
    })

    await user.click(screen.getByText('workflow.nodes.assigner.operations.over-write'))
    await user.click(screen.getAllByText('workflow.nodes.assigner.operations.set').at(-1)!)

    expect(handleChange.mock.lastCall?.[0]).toEqual([
      createOperation({
        operation: WriteMode.set,
        input_type: AssignerNodeInputType.constant,
        value: false,
      }),
    ])

    rerender(
      <VarList
        readonly={false}
        nodeId="node-current"
        list={[
          createOperation({
            operation: WriteMode.set,
            input_type: AssignerNodeInputType.constant,
            value: false,
          }),
        ]}
        onChange={handleChange}
        onOpen={vi.fn()}
        getAssignedVarType={() => VarType.boolean}
        getToAssignedVarType={() => VarType.boolean}
        writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
        writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
        writeModeTypesNum={[WriteMode.increment]}
      />,
    )

    await user.click(screen.getByText('True'))

    expect(handleChange.mock.lastCall?.[0]).toEqual([
      createOperation({
        operation: WriteMode.set,
        input_type: AssignerNodeInputType.constant,
        value: true,
      }),
    ])
  })

  it('opens the assigned-variable picker and removes an operation', () => {
    const { handleChange, handleOpen } = renderVarList({
      list: [createOperation()],
    })

    fireEvent.click(screen.getAllByTestId('var-reference-picker-trigger')[0]!)
    expect(handleOpen).toHaveBeenCalledWith(0)

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1]!)

    expect(handleChange).toHaveBeenLastCalledWith([])
  })
})
