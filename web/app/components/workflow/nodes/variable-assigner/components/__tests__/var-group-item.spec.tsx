import type { ComponentProps } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { toast } from '@/app/components/base/ui/toast'
import { createNode, resetFixtureCounters } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import VarGroupItem from '../var-group-item'

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const mockToast = vi.mocked(toast)

const createPayload = () => ({
  group_name: 'Group_A',
  output_type: VarType.any,
  variables: [] as string[][],
})

const currentNode = createNode({
  id: 'node-1',
  data: {
    type: BlockEnum.VariableAssigner,
    title: 'Variable Assigner',
  },
})

const renderGroupItem = (props: Partial<ComponentProps<typeof VarGroupItem>> = {}) => {
  return renderWorkflowFlowComponent(
    <VarGroupItem
      readOnly={false}
      nodeId="node-1"
      payload={createPayload()}
      onChange={vi.fn()}
      groupEnabled
      availableVars={[]}
      {...props}
    />,
    {
      nodes: [currentNode],
      edges: [],
      hooksStoreProps: {},
    },
  )
}

describe('variable-assigner/var-group-item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetFixtureCounters()
  })

  it('renders the empty group and forwards group-name edits', () => {
    const handleGroupNameChange = vi.fn()

    renderGroupItem({
      onGroupNameChange: handleGroupNameChange,
    })

    expect(screen.getByText('workflow.nodes.variableAssigner.noVarTip')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Group_A'))
    fireEvent.change(screen.getByDisplayValue('Group_A'), {
      target: { value: 'Next_Group' },
    })

    expect(handleGroupNameChange).toHaveBeenCalledWith('Next_Group')
  })

  it('rejects invalid group names and forwards remove actions', () => {
    const handleRemove = vi.fn()
    const { container } = renderGroupItem({
      onGroupNameChange: vi.fn(),
      canRemove: true,
      onRemove: handleRemove,
    })

    fireEvent.click(screen.getByText('Group_A'))
    fireEvent.change(screen.getByDisplayValue('Group_A'), {
      target: { value: '1bad' },
    })

    expect(mockToast.error).toHaveBeenCalled()

    const removeButton = container.querySelector('.cursor-pointer.rounded-md.p-1')
    fireEvent.click(removeButton as HTMLElement)

    expect(handleRemove).toHaveBeenCalledTimes(1)
  })
})
