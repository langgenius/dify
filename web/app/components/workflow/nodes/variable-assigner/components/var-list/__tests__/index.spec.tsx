import type { ComponentProps } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { createNode, resetFixtureCounters } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import VarList from '../index'

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: ({
    onOpen,
    onChange,
  }: {
    onOpen?: () => void
    onChange: (value: string[]) => void
  }) => (
    <div>
      <button type="button" data-testid="var-reference-picker-trigger" onClick={onOpen}>open-picker</button>
      <button type="button" onClick={() => onChange(['node-a', 'answer'])}>select-answer</button>
    </div>
  ),
}))

const sourceNode = createNode({
  id: 'node-a',
  data: {
    type: BlockEnum.Code,
    title: 'Source Node',
    outputs: {
      answer: { type: VarType.string },
    },
  },
})

const currentNode = createNode({
  id: 'node-current',
  data: {
    type: BlockEnum.VariableAssigner,
    title: 'Variable Assigner',
  },
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

describe('variable-assigner/var-list', () => {
  beforeEach(() => {
    resetFixtureCounters()
  })

  it('renders the empty placeholder when no variables are configured', () => {
    renderVarList()

    expect(screen.getByText('workflow.nodes.variableAssigner.noVarTip')).toBeInTheDocument()
  })

  it('opens the picker and removes an assigned variable', () => {
    const { handleChange, handleOpen } = renderVarList({
      list: [['node-a', 'answer']],
    })

    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))
    expect(handleOpen).toHaveBeenCalledWith(0)

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1]!)

    expect(handleChange).toHaveBeenLastCalledWith([])
  })

  it('updates a selected variable through the reference picker', async () => {
    const { handleChange } = renderVarList({
      list: [['node-a', 'answer']],
    })

    fireEvent.click(screen.getByRole('button', { name: 'select-answer' }))

    expect(handleChange).toHaveBeenLastCalledWith(
      [['node-a', 'answer']],
      ['node-a', 'answer'],
    )
  })
})
