import type { ButtonHTMLAttributes } from 'react'
import type { NodeDefault } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import NodeSelector from '../main'
import { BlockClassificationEnum } from '../types'

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => [],
    }),
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: () => ({
    plugins: [],
    isLoading: false,
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
  useInvalidateAllBuiltInTools: () => vi.fn(),
}))

const createBlock = (type: BlockEnum, title: string): NodeDefault => ({
  metaData: {
    classification: BlockClassificationEnum.Default,
    sort: 0,
    type,
    title,
    author: 'Dify',
    description: `${title} description`,
  },
  defaultValue: {},
  checkValid: () => ({ isValid: true }),
})

describe('NodeSelector', () => {
  it('opens with the real blocks tab, filters by search, selects a block, and clears search after close', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    renderWorkflowComponent(
      <NodeSelector
        onSelect={onSelect}
        blocks={[
          createBlock(BlockEnum.LLM, 'LLM'),
          createBlock(BlockEnum.End, 'End'),
        ]}
        availableBlocksTypes={[BlockEnum.LLM, BlockEnum.End]}
        trigger={open => (
          <button type="button">
            {open ? 'selector-open' : 'selector-closed'}
          </button>
        )}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'selector-closed' })
    expect(trigger.closest('[aria-haspopup="dialog"]')).toBe(trigger)

    await user.click(trigger)

    const searchInput = screen.getByPlaceholderText('workflow.tabs.searchBlock')
    expect(screen.getByText('LLM')).toBeInTheDocument()
    expect(screen.getByText('End')).toBeInTheDocument()

    await user.type(searchInput, 'LLM')
    expect(screen.getByText('LLM')).toBeInTheDocument()
    expect(screen.queryByText('End')).not.toBeInTheDocument()

    await user.click(screen.getByText('LLM'))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.LLM, undefined)
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('workflow.tabs.searchBlock')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'selector-closed' }))

    const reopenedInput = screen.getByPlaceholderText('workflow.tabs.searchBlock') as HTMLInputElement
    expect(reopenedInput.value).toBe('')
    expect(screen.getByText('End')).toBeInTheDocument()
  })

  it('does not open or emit open changes when disabled', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    renderWorkflowComponent(
      <NodeSelector
        disabled
        onOpenChange={onOpenChange}
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM]}
        trigger={open => (
          <button type="button">
            {open ? 'selector-open' : 'selector-closed'}
          </button>
        )}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'selector-closed' }))

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('workflow.tabs.searchBlock')).not.toBeInTheDocument()
  })

  it('preserves the custom trigger click handler', async () => {
    const user = userEvent.setup()
    const onTriggerClick = vi.fn()

    renderWorkflowComponent(
      <NodeSelector
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM]}
        trigger={() => (
          <button type="button" onClick={onTriggerClick}>
            open-selector
          </button>
        )}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'open-selector' }))

    expect(onTriggerClick).toHaveBeenCalledTimes(1)
    expect(screen.getByPlaceholderText('workflow.tabs.searchBlock')).toBeInTheDocument()
  })

  it('opens when a custom component trigger does not forward props', async () => {
    const user = userEvent.setup()

    function TriggerShell() {
      return (
        <span>
          open-from-shell
        </span>
      )
    }

    renderWorkflowComponent(
      <NodeSelector
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM]}
        trigger={() => <TriggerShell />}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'open-from-shell' }))

    expect(screen.getByPlaceholderText('workflow.tabs.searchBlock')).toBeInTheDocument()
  })

  it('can render a prop-forwarding button component as the popover root', async () => {
    const user = userEvent.setup()

    function ForwardingButtonTrigger(props: ButtonHTMLAttributes<HTMLButtonElement>) {
      return (
        <button type="button" data-testid="selector-root-trigger" {...props}>
          open-selector-root
        </button>
      )
    }

    renderWorkflowComponent(
      <NodeSelector
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM]}
        renderTriggerAsButtonRoot
        trigger={() => <ForwardingButtonTrigger />}
      />,
    )

    const trigger = screen.getByTestId('selector-root-trigger')
    await user.click(trigger)

    expect(trigger.closest('[aria-haspopup="dialog"]')).toBe(trigger)
    expect(screen.getByPlaceholderText('workflow.tabs.searchBlock')).toBeInTheDocument()
  })

  it('can render the shared Button trigger as the popover root', async () => {
    const user = userEvent.setup()

    renderWorkflowComponent(
      <NodeSelector
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM]}
        renderTriggerAsButtonRoot
        trigger={() => (
          <Button variant="primary">
            open-shared-button-trigger
          </Button>
        )}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'open-shared-button-trigger' })
    await user.click(trigger)

    expect(trigger.closest('[aria-haspopup="dialog"]')).toBe(trigger)
    expect(screen.getByPlaceholderText('workflow.tabs.searchBlock')).toBeInTheDocument()
  })
})
