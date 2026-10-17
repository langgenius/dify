import { ContextMenu } from '@langgenius/dify-ui/context-menu'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fullWorkflowAccessControl } from '../hooks-store'
import { PanelContextmenu } from '../panel-contextmenu'
import { BlockEnum } from '../types'
import { createNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

const mockUseNodesInteractions = vi.hoisted(() => vi.fn())
const mockUseWorkflowStartRun = vi.hoisted(() => vi.fn())
const mockUseWorkflowMoveMode = vi.hoisted(() => vi.fn())
const mockUseOperator = vi.hoisted(() => vi.fn())
const mockUseDSL = vi.hoisted(() => vi.fn())
const mockUseAvailableBlocks = vi.hoisted(() => vi.fn())
const mockUseNodesMetaData = vi.hoisted(() => vi.fn())
let chatflowMode = false

vi.mock('../hooks/use-DSL', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-DSL')>()

  return {
    ...actual,
    useDSL: () => mockUseDSL(),
  }
})

vi.mock('../hooks/use-available-blocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-available-blocks')>()

  return {
    ...actual,
    useAvailableBlocks: () => mockUseAvailableBlocks(),
  }
})

vi.mock('../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-nodes-interactions')>()

  return {
    ...actual,
    useNodesInteractions: () => mockUseNodesInteractions(),
  }
})

vi.mock('../hooks/use-nodes-meta-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-nodes-meta-data')>()

  return {
    ...actual,
    useNodesMetaData: () => mockUseNodesMetaData(),
  }
})

vi.mock('../hooks/use-workflow-panel-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-workflow-panel-interactions')>()

  return {
    ...actual,
    useWorkflowMoveMode: () => mockUseWorkflowMoveMode(),
  }
})

vi.mock('../hooks/use-workflow-start-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/use-workflow-start-run')>()

  return {
    ...actual,
    useWorkflowStartRun: () => mockUseWorkflowStartRun(),
  }
})

vi.mock('@/app/components/workflow/operator/hooks', () => ({
  useOperator: () => mockUseOperator(),
}))

describe('PanelContextmenu', () => {
  const mockHandleNodesPaste = vi.fn()
  const mockClose = vi.fn()
  const mockHandleStartWorkflowRun = vi.fn()
  const mockHandleWorkflowStartRunInChatflow = vi.fn()
  const mockHandleAddNote = vi.fn()
  const mockExportCheck = vi.fn()
  const defaultNodesMetaDataMap = {
    [BlockEnum.Answer]: {
      defaultValue: {
        title: 'Answer',
        desc: '',
        type: BlockEnum.Answer,
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodesInteractions.mockReturnValue({
      handleNodesPaste: mockHandleNodesPaste,
    })
    mockUseWorkflowStartRun.mockReturnValue({
      handleStartWorkflowRun: mockHandleStartWorkflowRun,
      handleWorkflowStartRunInChatflow: mockHandleWorkflowStartRunInChatflow,
    })
    mockUseWorkflowMoveMode.mockReturnValue({
      isCommentModeAvailable: false,
    })
    mockUseOperator.mockReturnValue({
      handleAddNote: mockHandleAddNote,
    })
    mockUseDSL.mockReturnValue({
      exportCheck: mockExportCheck,
    })
    mockUseAvailableBlocks.mockReturnValue({
      availableNextBlocks: [BlockEnum.Answer],
    })
    mockUseNodesMetaData.mockReturnValue({
      nodesMap: defaultNodesMetaDataMap,
    })
    chatflowMode = false
  })

  const renderPanelContextmenu = (options?: Parameters<typeof renderWorkflowFlowComponent>[1]) => {
    return renderWorkflowFlowComponent(
      <ContextMenu open>
        <PanelContextmenu onClose={mockClose} />
      </ContextMenu>,
      {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: chatflowMode ? 'advanced-chat' : 'workflow',
        },
        ...options,
      },
    )
  }

  it('should stay hidden when the panel menu is absent', () => {
    renderPanelContextmenu()

    expect(screen.queryByText('workflow.common.addBlock')).not.toBeInTheDocument()
  })

  it('should keep paste disabled when the clipboard is empty', async () => {
    renderPanelContextmenu({
      initialStoreState: {
        contextMenuTarget: { type: 'panel' },
      },
      hooksStoreProps: {},
    })

    await screen.findByText('workflow.common.pasteHere')
    await userEvent.setup().click(screen.getByText('workflow.common.pasteHere'))

    expect(mockHandleNodesPaste).not.toHaveBeenCalled()
    expect(mockClose).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'handles menu paste only when clipboard is available: %s',
    async (hasClipboard) => {
      const user = userEvent.setup()
      renderPanelContextmenu({
        initialStoreState: {
          contextMenuTarget: { type: 'panel' },
          clipboardElements: hasClipboard ? [createNode({ id: 'copied-node' })] : [],
        },
        hooksStoreProps: {},
      })
      const item = await screen.findByRole('menuitem', { name: /workflow.common.run/ })
      act(() => item.focus())
      const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
      await user.keyboard(`{${mod}>}v{/${mod}}`)
      expect(mockHandleNodesPaste).toHaveBeenCalledTimes(hasClipboard ? 1 : 0)
      expect(mockClose).toHaveBeenCalledTimes(hasClipboard ? 1 : 0)
    },
  )

  it('should render actions and execute enabled actions', async () => {
    const { store } = renderPanelContextmenu({
      initialStoreState: {
        contextMenuTarget: { type: 'panel' },
        clipboardElements: [createNode({ id: 'copied-node' })],
      },
      hooksStoreProps: {},
    })

    expect(await screen.findByText('workflow.common.addBlock')).toBeInTheDocument()
    expect(screen.getByText('workflow.common.run')).toBeInTheDocument()
    expect(screen.getByText('workflow.common.pasteHere')).toBeInTheDocument()

    await userEvent.setup().click(screen.getByText('workflow.nodes.note.addNote'))
    await userEvent.setup().click(screen.getByText('workflow.common.run'))
    await userEvent.setup().click(screen.getByText('workflow.common.pasteHere'))
    await userEvent.setup().click(screen.getByText('app.exportApp'))
    await userEvent.setup().click(screen.getByText('app.importApp'))

    await waitFor(() => {
      expect(mockHandleAddNote).toHaveBeenCalledTimes(1)
      expect(mockHandleStartWorkflowRun).toHaveBeenCalledTimes(1)
      expect(mockHandleNodesPaste).toHaveBeenCalledTimes(1)
      expect(mockExportCheck).toHaveBeenCalledTimes(1)
      expect(store.getState().showImportDSLModal).toBe(true)
    })
  })

  it('should hide import app on snippet canvases', async () => {
    renderPanelContextmenu({
      initialStoreState: {
        contextMenuTarget: { type: 'panel' },
      },
      resource: { kind: 'snippet' as const, snippetId: 'snippet-1' },
      hooksStoreProps: {
        fileSettings: {},
      },
    })

    expect(await screen.findByText('app.exportApp')).toBeInTheDocument()
    expect(screen.queryByText('app.importApp')).not.toBeInTheDocument()
  })

  it('should render preview action in chat mode', async () => {
    chatflowMode = true

    renderPanelContextmenu({
      initialStoreState: {
        contextMenuTarget: { type: 'panel' },
      },
      hooksStoreProps: {},
    })

    expect(await screen.findByText('workflow.common.debugAndPreview')).toBeInTheDocument()
    expect(screen.queryByText('workflow.common.run')).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByText('workflow.common.debugAndPreview'))

    await waitFor(() => {
      expect(mockHandleWorkflowStartRunInChatflow).toHaveBeenCalledTimes(1)
      expect(mockHandleStartWorkflowRun).not.toHaveBeenCalled()
      expect(mockClose).toHaveBeenCalled()
    })
  })

  it('should hide add note but keep comments available when editing is denied', async () => {
    mockUseWorkflowMoveMode.mockReturnValue({
      isCommentModeAvailable: true,
    })

    renderPanelContextmenu({
      initialStoreState: {
        contextMenuTarget: { type: 'panel' },
      },
      hooksStoreProps: {
        accessControl: {
          ...fullWorkflowAccessControl,
          canEdit: false,
        },
      },
    })

    expect(
      await screen.findByText('workflowComments.comments.actions.addComment'),
    ).toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.note.addNote')).not.toBeInTheDocument()
  })
})
