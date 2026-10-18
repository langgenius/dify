import type { Node } from '../../types'
import { render as renderComponent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '../../__tests__/fixtures'
import { WorkflowContext } from '../../context'
import { createWorkflowStore } from '../../store/workflow'
import { BlockEnum } from '../../types'
import StartBlocks from '../start-blocks'

let nodes: Node[] = []
const render = (ui: React.ReactElement) => {
  const store = createWorkflowStore({})
  store.setState({ nodes })
  return renderComponent(<WorkflowContext value={store}>{ui}</WorkflowContext>)
}

describe('StartBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nodes = []
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

      const userInputButton = screen.getByRole('button', { name: 'workflow.blocks.start' })
      expect(userInputButton).toBeInTheDocument()
      expect(userInputButton).toHaveAccessibleDescription(
        'workflow.nodes.start.userInputTipDescription',
      )
      expect(screen.getByText('workflow.blocks.trigger-webhook')).toBeInTheDocument()
      expect(screen.getByText('workflow.blocks.originalStartNode')).toBeInTheDocument()
      expect(onContentStateChange).toHaveBeenCalledWith(true)

      await user.click(userInputButton)

      expect(onSelect).toHaveBeenCalledWith(BlockEnum.Start)
    })

    it.each([true, false])(
      'hides user input for an existing start node or an explicit request (existing=%s)',
      (hasStart) => {
        const onContentStateChange = vi.fn()
        nodes = hasStart ? [createNode({ data: { type: BlockEnum.Start } })] : []

        const { container } = render(
          <StartBlocks
            searchText=""
            onSelect={vi.fn()}
            availableBlocksTypes={[BlockEnum.Start]}
            onContentStateChange={onContentStateChange}
            hideUserInput={!hasStart}
          />,
        )

        expect(container).toBeEmptyDOMElement()
        expect(screen.queryByText('workflow.blocks.start')).not.toBeInTheDocument()
        expect(onContentStateChange).toHaveBeenCalledWith(false)
      },
    )

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

      await user.tab()
      expect(userInputButton).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(onSelect).not.toHaveBeenCalled()
    })
  })
})
