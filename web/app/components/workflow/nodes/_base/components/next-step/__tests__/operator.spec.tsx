import type { CommonNodeType } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAvailableBlocks } from '../../../../../hooks/use-available-blocks'
import { useNodesInteractions } from '../../../../../hooks/use-nodes-interactions'
import Operator from '../operator'

vi.mock('../../../../../hooks/use-available-blocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../hooks/use-available-blocks')>()

  return {
    ...actual,
    useAvailableBlocks: vi.fn(),
  }
})

vi.mock('../../../../../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../../hooks/use-nodes-interactions')>()

  return {
    ...actual,
    useNodesInteractions: vi.fn(),
  }
})

const mockUseAvailableBlocks = vi.mocked(useAvailableBlocks)
const mockUseNodesInteractions = vi.mocked(useNodesInteractions)

const mockHandleNodeChange = vi.fn()
const mockHandleNodeDelete = vi.fn()
const mockHandleNodeDisconnect = vi.fn()

const defaultNodeData = {
  type: BlockEnum.Code,
  title: 'Code Node',
} as CommonNodeType

const TestHarness = () => {
  const [open, setOpen] = useState(false)
  return (
    <Operator
      open={open}
      onOpenChange={setOpen}
      data={defaultNodeData}
      nodeId="node-1"
      sourceHandle="source"
    />
  )
}

describe('NextStep operator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAvailableBlocks.mockReturnValue({
      availablePrevBlocks: [BlockEnum.HttpRequest],
      availableNextBlocks: [BlockEnum.HttpRequest],
      getAvailableBlocks: vi.fn(),
    } as ReturnType<typeof useAvailableBlocks>)
    mockUseNodesInteractions.mockReturnValue({
      handleNodeChange: mockHandleNodeChange,
      handleNodeDelete: mockHandleNodeDelete,
      handleNodeDisconnect: mockHandleNodeDisconnect,
    } as unknown as ReturnType<typeof useNodesInteractions>)
  })

  it('opens the menu and keeps the change action available', async () => {
    const user = userEvent.setup()
    render(<TestHarness />)

    await user.click(screen.getAllByRole('button')[0]!)

    expect(screen.getByText('workflow.panel.change')).toBeInTheDocument()
    expect(screen.getByText('workflow.common.disconnect')).toBeInTheDocument()
    expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
  })

  it('disconnects and deletes the next step from the menu', async () => {
    const user = userEvent.setup()
    render(<TestHarness />)

    await user.click(screen.getAllByRole('button')[0]!)
    await user.click(screen.getByText('workflow.common.disconnect'))
    expect(mockHandleNodeDisconnect).toHaveBeenCalledWith('node-1')
    expect(screen.queryByText('workflow.common.disconnect')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button')[0]!)
    await user.click(screen.getByText('common.operation.delete'))
    expect(mockHandleNodeDelete).toHaveBeenCalledWith('node-1')
  })
})
