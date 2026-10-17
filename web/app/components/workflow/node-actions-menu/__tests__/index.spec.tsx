import { detectPlatform } from '@tanstack/react-hotkeys'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { useNodesInteractions } from '../../hooks/use-nodes-interactions'
import { useNodeMetaData } from '../../hooks/use-nodes-meta-data'
import { NodeActionsDropdown } from '../index'

vi.mock('../../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-nodes-interactions')>()

  return {
    ...actual,
    useNodesInteractions: vi.fn(),
  }
})

vi.mock('../../hooks/use-nodes-meta-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-nodes-meta-data')>()

  return {
    ...actual,
    useNodeMetaData: vi.fn(),
  }
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.workflow.get': async () => [],
    }),
  }
})

vi.mock('../change-block-popup', () => ({
  ChangeBlockPopup: () => <div data-testid="node-actions-change-block" />,
}))

const mockUseNodeMetaData = vi.mocked(useNodeMetaData)
const mockUseNodesInteractions = vi.mocked(useNodesInteractions)
const renderComponent = (
  showHelpLink: boolean = true,
  onOpenChange?: (open: boolean) => void,
  readOnly = false,
) =>
  renderWorkflowFlowComponent(
    <NodeActionsDropdown
      id="node-1"
      data={{
        title: 'Code Node',
        desc: '',
        type: BlockEnum.Code,
      }}
      triggerClassName="node-actions-trigger"
      onOpenChange={onOpenChange}
      showHelpLink={showHelpLink}
    />,
    {
      initialStoreState: { canvasReadOnly: readOnly },
      nodes: [],
      edges: [],
    },
  )

describe('NodeActionsDropdown', () => {
  const handleNodeSelect = vi.fn()
  const handleNodeDelete = vi.fn()
  const handleNodesCopy = vi.fn()
  const handleNodesDuplicate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodeMetaData.mockReturnValue({
      isTypeFixed: false,
      isSingleton: false,
      isUndeletable: false,
      description: 'Node description',
      author: 'Dify',
      helpLinkUri: 'https://docs.example.com/node',
    } as ReturnType<typeof useNodeMetaData>)
    mockUseNodesInteractions.mockReturnValue({
      handleNodeDelete,
      handleNodesDuplicate,
      handleNodeSelect,
      handleNodesCopy,
    } as unknown as ReturnType<typeof useNodesInteractions>)
  })

  it('should open the dropdown and trigger single-run actions', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const { store } = renderComponent(true, onOpenChange)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(screen.getByText('workflow.panel.runThisStep')).toBeInTheDocument()
    expect(screen.getByText('Node description')).toBeInTheDocument()

    await user.click(screen.getByText('workflow.panel.runThisStep'))

    expect(handleNodeSelect).toHaveBeenCalledWith('node-1')
    expect(store.getState().initShowLastRunTab).toBe(true)
    expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'node-1', action: 'run' })
  })

  it.each([
    { key: 'c', action: handleNodesCopy },
    { key: 'd', action: handleNodesDuplicate },
    { key: 'Delete', action: handleNodeDelete },
    { key: 'Backspace', action: handleNodeDelete },
  ])('runs $key from the focused portalled node menu', async ({ key, action }) => {
    const user = userEvent.setup()
    const { container } = renderComponent()
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.keyboard('{ArrowDown}')
    const focusedItem = document.activeElement
    expect(focusedItem).toHaveAttribute('role', 'menuitem')
    expect(container.contains(focusedItem)).toBe(false)

    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    await user.keyboard(key.length === 1 ? `{${mod}>}${key}{/${mod}}` : `{${key}}`)

    expect(action).toHaveBeenCalledExactlyOnceWith('node-1')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('leaves composition alone and consumes held shortcuts without repeating the action', async () => {
    const user = userEvent.setup()
    renderComponent()
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.keyboard('{ArrowDown}')
    const item = document.activeElement!
    const modifier = detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }
    const composing = new KeyboardEvent('keydown', {
      key: 'd',
      ...modifier,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(item, composing)
    expect(composing.defaultPrevented).toBe(false)
    const repeat = new KeyboardEvent('keydown', {
      key: 'd',
      ...modifier,
      repeat: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(item, repeat)
    expect(repeat.defaultPrevented).toBe(true)
    expect(handleNodesDuplicate).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('does not run unavailable editing shortcuts from a readonly node menu', async () => {
    const user = userEvent.setup()
    renderComponent(true, undefined, true)
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.keyboard('{ArrowDown}')
    const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
    await user.keyboard(`{${mod}>}cd{/${mod}}{Delete}`)
    expect(handleNodesCopy).not.toHaveBeenCalled()
    expect(handleNodesDuplicate).not.toHaveBeenCalled()
    expect(handleNodeDelete).not.toHaveBeenCalled()
  })

  it('should hide single-run actions when nodes are readonly', async () => {
    const user = userEvent.setup()

    renderComponent(true, undefined, true)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

    expect(screen.queryByText('workflow.panel.runThisStep')).not.toBeInTheDocument()
  })

  it('should hide the help link when showHelpLink is false', async () => {
    const user = userEvent.setup()
    renderComponent(false)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

    expect(screen.queryByText('workflow.panel.helpLink')).not.toBeInTheDocument()
    expect(screen.getByText('Node description')).toBeInTheDocument()
  })
})
