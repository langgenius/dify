import type { CommonNodeType } from '../../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { useAvailableNodesMetaData } from '../../../workflow-app/hooks'
import { BlockEnum } from '../../types'
import StartBlocks from '../start-blocks'

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  default: vi.fn(),
}))

vi.mock('../../../workflow-app/hooks', () => ({
  useAvailableNodesMetaData: vi.fn(),
}))

const mockUseNodes = vi.mocked(useNodes)
const mockUseAvailableNodesMetaData = vi.mocked(useAvailableNodesMetaData)

const createNode = (type: BlockEnum) => ({
  data: { type } as Pick<CommonNodeType, 'type'>,
}) as ReturnType<typeof useNodes>[number]

const createAvailableNodesMetaData = (): ReturnType<typeof useAvailableNodesMetaData> => ({
  nodes: [],
} as unknown as ReturnType<typeof useAvailableNodesMetaData>)

describe('StartBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodes.mockReturnValue([])
    mockUseAvailableNodesMetaData.mockReturnValue(createAvailableNodesMetaData())
  })

  // Start block selection should respect available types and workflow state.
  describe('Filtering and Selection', () => {
    it('should render available start blocks and forward selection', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      const onContentStateChange = vi.fn()

      render(
        <StartBlocks
          searchText=""
          onSelect={onSelect}
          availableBlocksTypes={[BlockEnum.Start, BlockEnum.TriggerWebhook]}
          onContentStateChange={onContentStateChange}
        />,
      )

      expect(screen.getByText('workflow.blocks.start')).toBeInTheDocument()
      expect(screen.getByText('workflow.blocks.trigger-webhook')).toBeInTheDocument()
      expect(screen.getByText('workflow.blocks.originalStartNode')).toBeInTheDocument()
      expect(onContentStateChange).toHaveBeenCalledWith(true)

      await user.click(screen.getByText('workflow.blocks.start'))

      expect(onSelect).toHaveBeenCalledWith(BlockEnum.Start)
    })

    it('should hide user input when a start node already exists or hideUserInput is enabled', () => {
      const onContentStateChange = vi.fn()
      mockUseNodes.mockReturnValue([createNode(BlockEnum.Start)])

      const { container } = render(
        <StartBlocks
          searchText=""
          onSelect={vi.fn()}
          availableBlocksTypes={[BlockEnum.Start]}
          onContentStateChange={onContentStateChange}
          hideUserInput
        />,
      )

      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByText('workflow.blocks.start')).not.toBeInTheDocument()
      expect(onContentStateChange).toHaveBeenCalledWith(false)
    })

    it('should show most common badge for user input in the start selector content', () => {
      render(
        <StartBlocks
          searchText=""
          onSelect={vi.fn()}
          availableBlocksTypes={[BlockEnum.Start]}
          showMostCommonBadge
        />,
      )

      expect(screen.getByText('workflow.blocks.mostCommon')).toBeInTheDocument()
      expect(screen.queryByText('workflow.blocks.originalStartNode')).not.toBeInTheDocument()
    })

    it('should render built-in start block preview titles and Dify Team author', async () => {
      const user = userEvent.setup()

      render(
        <StartBlocks
          searchText=""
          onSelect={vi.fn()}
          availableBlocksTypes={[BlockEnum.Start, BlockEnum.TriggerWebhook]}
        />,
      )

      await user.hover(screen.getByText('workflow.blocks.trigger-webhook'))

      expect(screen.queryByText('workflow.customWebhook')).not.toBeInTheDocument()
      await waitFor(() => {
        expect(screen.getAllByText('workflow.blocks.trigger-webhook')).toHaveLength(2)
      })

      await user.hover(screen.getByText('workflow.blocks.start'))

      await waitFor(() => {
        expect(document.body).toHaveTextContent('tools.author workflow.difyTeam')
      })
    })

    it('should keep disabled user input reachable from the keyboard with the conflict reason', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <StartBlocks
          searchText=""
          onSelect={onSelect}
          availableBlocksTypes={[BlockEnum.Start]}
          showMostCommonBadge
          showUserInputDisabled
        />,
      )

      const userInputButton = screen.getByRole('button', {
        name: /workflow\.blocks\.start.*workflow\.nodes\.startPlaceholder\.userInputConflictTip/,
      })
      expect(userInputButton).toHaveAttribute('aria-disabled', 'true')
      expect(userInputButton.querySelector('.i-custom-vender-workflow-user-input')?.closest('.opacity-30')).toBeInTheDocument()

      await user.tab()
      expect(userInputButton).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(onSelect).not.toHaveBeenCalled()
    })
  })
})
