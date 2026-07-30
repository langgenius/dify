import type { ButtonHTMLAttributes, ReactElement } from 'react'
import type { NodeDefault } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { FlowType } from '@/types/common'
import BlockSelector from '..'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { BlockClassification, TabType } from '../types'

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
  useFeaturedTriggersRecommendations: () => ({
    plugins: [],
    isLoading: false,
  }),
}))

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: () => ({ data: undefined }),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({ data: [] }),
  useInvalidateAllTriggerPlugins: () => vi.fn(),
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
    classification: BlockClassification.Default,
    sort: 0,
    type,
    title,
    author: 'Dify',
    description: `${title} description`,
  },
  defaultValue: {},
  checkValid: () => ({ isValid: true }),
})

type RenderBlockSelectorOptions = Parameters<typeof renderWorkflowComponent>[1]

const renderBlockSelector = (ui: ReactElement, options?: RenderBlockSelectorOptions) => {
  return renderWorkflowComponent(ui, {
    ...options,
    hooksStoreProps: {
      ...options?.hooksStoreProps,
      configsMap: {
        flowId: 'app-1',
        flowType: FlowType.appFlow,
        fileSettings: {} as never,
        ...options?.hooksStoreProps?.configsMap,
      },
    },
  })
}

describe('BlockSelector', () => {
  it('resolves available blocks from the mounted workflow content owner', async () => {
    renderBlockSelector(
      <BlockSelector open onSelect={vi.fn()} availableBlocksTypes={[BlockEnum.Code]} />,
      {
        hooksStoreProps: {
          availableNodesMetaData: {
            nodes: [
              createBlock(BlockEnum.Start, 'Start'),
              createBlock(BlockEnum.Tool, 'Tool'),
              createBlock(BlockEnum.Code, 'Code'),
            ],
          },
        },
      },
    )

    expect(await screen.findByText('Code')).toBeInTheDocument()
    expect(screen.queryByText('Start')).not.toBeInTheDocument()
    expect(screen.queryByText('Tool')).not.toBeInTheDocument()
  })

  it('opens with the real blocks tab, filters by search, selects a block, and clears search after close', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    renderBlockSelector(
      <BlockSelector
        onSelect={onSelect}
        blocks={[createBlock(BlockEnum.LLM, 'LLM'), createBlock(BlockEnum.End, 'End')]}
        availableBlocksTypes={[BlockEnum.LLM, BlockEnum.End]}
        trigger={(open) => (
          <button type="button">{open ? 'selector-open' : 'selector-closed'}</button>
        )}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'selector-closed' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')

    await user.click(trigger)

    expect(screen.getByRole('dialog', { name: 'workflow.common.addBlock' })).toBeInTheDocument()

    const searchInput = screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })
    expect(screen.getByText('LLM')).toBeInTheDocument()
    expect(screen.getByText('End')).toBeInTheDocument()

    await user.type(searchInput, 'LLM')
    expect(screen.getByText('LLM')).toBeInTheDocument()
    expect(screen.queryByText('End')).not.toBeInTheDocument()

    await user.click(screen.getByText('LLM'))

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.LLM, undefined)
    await waitFor(() => {
      expect(
        screen.queryByRole('searchbox', { name: 'workflow.tabs.searchBlock' }),
      ).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'selector-closed' }))

    const reopenedInput = screen.getByRole('searchbox', {
      name: 'workflow.tabs.searchBlock',
    }) as HTMLInputElement
    expect(reopenedInput.value).toBe('')
    expect(screen.getByText('End')).toBeInTheDocument()
  })

  it('resets to the default tab after closing', async () => {
    const user = userEvent.setup()

    renderBlockSelector(
      <BlockSelector
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM, BlockEnum.Start]}
        showStartTab
        trigger={(open) => (
          <button type="button">{open ? 'selector-open' : 'selector-closed'}</button>
        )}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'selector-closed' }))
    await user.click(screen.getByText('workflow.tabs.start'))

    expect(
      screen.getByRole('searchbox', { name: 'workflow.tabs.searchTrigger' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'selector-open' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('searchbox', { name: 'workflow.tabs.searchTrigger' }),
      ).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'selector-closed' }))

    expect(screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })).toBeInTheDocument()
  })

  it('preserves the current popup session until a controlled close actually unmounts it', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    renderBlockSelector(
      <BlockSelector
        open
        onOpenChange={onOpenChange}
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM, BlockEnum.Start]}
        showStartTab
        trigger={() => <button type="button">selector-open</button>}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'workflow.tabs.start' }))
    const searchInput = screen.getByRole('searchbox', { name: 'workflow.tabs.searchTrigger' })
    await user.type(searchInput, 'webhook')
    await user.click(screen.getByRole('button', { name: 'selector-open' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('tab', { name: 'workflow.tabs.start' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(searchInput).toHaveValue('webhook')
  })

  it('focuses search and exposes a non-tabbing close action for touch screen readers', async () => {
    const user = userEvent.setup()

    renderBlockSelector(
      <BlockSelector
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM, BlockEnum.Start]}
        showStartTab
        trigger={(open) => (
          <button type="button">{open ? 'selector-open' : 'selector-closed'}</button>
        )}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'selector-closed' }))
    expect(screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })).toHaveFocus()
    await waitFor(() => {
      expect(screen.getByRole('dialog').parentElement).toHaveStyle({ position: 'fixed' })
    })

    await user.tab({ shift: true })
    const blocksTab = screen.getByRole('tab', { name: 'workflow.tabs.blocks' })
    expect(blocksTab).toHaveFocus()

    const closeButton = screen.getByRole('button', { name: 'common.operation.close' })
    expect(closeButton).toHaveAttribute('tabindex', '-1')

    const startTab = screen.getByRole('tab', { name: 'workflow.tabs.start' })
    await user.click(startTab)

    expect(startTab).toHaveFocus()
    expect(screen.getByRole('searchbox', { name: 'workflow.tabs.searchTrigger' })).not.toHaveFocus()
  })

  it('does not open or emit open changes when disabled', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    renderBlockSelector(
      <BlockSelector
        disabled
        onOpenChange={onOpenChange}
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM]}
        trigger={(open) => (
          <button type="button">{open ? 'selector-open' : 'selector-closed'}</button>
        )}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'selector-closed' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('searchbox', { name: 'workflow.tabs.searchBlock' }),
    ).not.toBeInTheDocument()
  })

  it('allows an open selector to close after it becomes disabled', async () => {
    const user = userEvent.setup()
    let disableSelector = () => {}

    function Harness() {
      const [open, setOpen] = useState(true)
      const [disabled, setDisabled] = useState(false)
      disableSelector = () => setDisabled(true)

      return (
        <BlockSelector
          open={open}
          disabled={disabled}
          onOpenChange={setOpen}
          onSelect={vi.fn()}
          blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
          trigger={() => <button type="button">selector-trigger</button>}
        />
      )
    }

    renderBlockSelector(<Harness />)
    expect(screen.getByRole('dialog', { name: 'workflow.common.addBlock' })).toBeInTheDocument()

    act(disableSelector)
    expect(screen.getByRole('button', { name: 'selector-trigger' })).toBeDisabled()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'workflow.common.addBlock' }),
      ).not.toBeInTheDocument()
    })
  })

  it('returns focus to the trigger after Escape', async () => {
    const user = userEvent.setup()

    renderBlockSelector(
      <BlockSelector
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        trigger={() => <button type="button">selector-trigger</button>}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'selector-trigger' })
    await user.click(trigger)
    expect(screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(trigger).toHaveFocus()
    expect(
      screen.queryByRole('dialog', { name: 'workflow.common.addBlock' }),
    ).not.toBeInTheDocument()
  })

  it('preserves the custom trigger click handler', async () => {
    const user = userEvent.setup()
    const onTriggerClick = vi.fn()

    renderBlockSelector(
      <BlockSelector
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
    expect(screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })).toBeInTheDocument()
  })

  it('can render a prop-forwarding button component as the popover root', async () => {
    const user = userEvent.setup()

    function ForwardingButtonTrigger(props: ButtonHTMLAttributes<HTMLButtonElement>) {
      return (
        <button type="button" {...props}>
          open-selector-root
        </button>
      )
    }

    renderBlockSelector(
      <BlockSelector
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM]}
        trigger={() => <ForwardingButtonTrigger />}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'open-selector-root' })
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })).toBeInTheDocument()
  })

  it('can render the shared Button trigger as the popover root', async () => {
    const user = userEvent.setup()

    renderBlockSelector(
      <BlockSelector
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM]}
        trigger={() => <Button variant="primary">open-shared-button-trigger</Button>}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'open-shared-button-trigger' })
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })).toBeInTheDocument()
  })

  it('isolates popup keyboard events when opened from another keyboard-managed overlay', async () => {
    const user = userEvent.setup()
    const handleParentKeyDown = vi.fn()

    renderBlockSelector(
      <BlockSelector
        open
        isolateKeyboardEvents
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM'), createBlock(BlockEnum.End, 'End')]}
        availableBlocksTypes={[BlockEnum.LLM, BlockEnum.End]}
      />,
    )

    const searchInput = screen.getByRole('searchbox', {
      name: 'workflow.tabs.searchBlock',
    }) as HTMLInputElement
    document.body.addEventListener('keydown', handleParentKeyDown)

    try {
      await user.type(searchInput, 'LLM')
    } finally {
      document.body.removeEventListener('keydown', handleParentKeyDown)
    }

    expect(searchInput.value).toBe('LLM')
    expect(handleParentKeyDown).not.toHaveBeenCalled()
    expect(screen.getByText('LLM')).toBeInTheDocument()
    expect(screen.queryByText('End')).not.toBeInTheDocument()
  })

  it('disables the start tab with a setup tooltip when an unconfigured start node is on the canvas', async () => {
    const user = userEvent.setup()

    renderBlockSelector(
      <BlockSelector
        open
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM, BlockEnum.Start]}
        showStartTab
        defaultActiveTab={TabType.Start}
      />,
      {
        initialStoreState: {
          nodes: [
            {
              id: 'start-placeholder',
              data: {
                type: BlockEnum.StartPlaceholder,
              },
            },
          ] as never,
        },
      },
    )

    await user.hover(screen.getByText('workflow.tabs.start'))

    expect(
      await screen.findByText('workflow.tabs.unconfiguredStartDisabledTip'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'workflow.tabs.searchBlock' })).toBeInTheDocument()
  })

  it('keeps the start tab enabled when a configured user input start node is on the canvas', () => {
    renderBlockSelector(
      <BlockSelector
        open
        onSelect={vi.fn()}
        blocks={[createBlock(BlockEnum.LLM, 'LLM')]}
        availableBlocksTypes={[BlockEnum.LLM, BlockEnum.Start, BlockEnum.TriggerPlugin]}
        showStartTab
        defaultActiveTab={TabType.Start}
      />,
      {
        initialStoreState: {
          nodes: [
            {
              id: 'start',
              data: {
                type: BlockEnum.Start,
              },
            },
          ] as never,
        },
      },
    )

    expect(screen.getByText('workflow.tabs.start')).toHaveAttribute('aria-disabled', 'false')
    expect(
      screen.getByText('workflow.nodes.startPlaceholder.userInputConflictTip'),
    ).toBeInTheDocument()
  })
})
