import { ContextMenu } from '@langgenius/dify-ui/context-menu'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { withSelectorKey } from '@/test/i18n-mock'
import { FlowType } from '@/types/common'
import { fullWorkflowAccessControl } from '../hooks-store'
import { PanelContextmenu } from '../panel-contextmenu'
import { BlockEnum } from '../types'
import { createNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseNodesInteractions = vi.hoisted(() => vi.fn())
const mockUsePanelInteractions = vi.hoisted(() => vi.fn())
const mockUseWorkflowStartRun = vi.hoisted(() => vi.fn())
const mockUseWorkflowMoveMode = vi.hoisted(() => vi.fn())
const mockUseOperator = vi.hoisted(() => vi.fn())
const mockUseDSL = vi.hoisted(() => vi.fn())
const mockUseNodesReadOnly = vi.hoisted(() => vi.fn())
const mockUseAvailableBlocks = vi.hoisted(() => vi.fn())
const mockUseNodesMetaData = vi.hoisted(() => vi.fn())
const mockUseIsChatMode = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useAvailableBlocks: () => mockUseAvailableBlocks(),
  useDSL: () => mockUseDSL(),
  useIsChatMode: () => mockUseIsChatMode(),
  useNodesInteractions: () => mockUseNodesInteractions(),
  useNodesMetaData: () => mockUseNodesMetaData(),
  useNodesReadOnly: () => mockUseNodesReadOnly(),
  usePanelInteractions: () => mockUsePanelInteractions(),
  useWorkflowMoveMode: () => mockUseWorkflowMoveMode(),
  useWorkflowStartRun: () => mockUseWorkflowStartRun(),
}))

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
    mockUseTranslation.mockReturnValue({
      t: withSelectorKey((key: string) => key),
    })
    mockUseNodesInteractions.mockReturnValue({
      handleNodesPaste: mockHandleNodesPaste,
    })
    mockUsePanelInteractions.mockReturnValue({})
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
    mockUseNodesReadOnly.mockReturnValue({
      nodesReadOnly: false,
    })
    mockUseAvailableBlocks.mockReturnValue({
      availableNextBlocks: [BlockEnum.Answer],
    })
    mockUseNodesMetaData.mockReturnValue({
      nodesMap: defaultNodesMetaDataMap,
    })
    mockUseIsChatMode.mockReturnValue(false)
  })

  const renderPanelContextmenu = (options?: Parameters<typeof renderWorkflowFlowComponent>[1]) => {
    return renderWorkflowFlowComponent(
      <ContextMenu open>
        <PanelContextmenu onClose={mockClose} />
      </ContextMenu>,
      options,
    )
  }

  it('should stay hidden when the panel menu is absent', () => {
    renderPanelContextmenu()

    expect(screen.queryByText('common.addBlock')).not.toBeInTheDocument()
  })

  it('should keep paste disabled when the clipboard is empty', async () => {
    renderPanelContextmenu({
      initialStoreState: {
        contextMenuTarget: { type: 'panel' },
      },
      hooksStoreProps: {},
    })

    await screen.findByText('common.pasteHere')
    fireEvent.click(screen.getByText('common.pasteHere'))

    expect(mockHandleNodesPaste).not.toHaveBeenCalled()
    expect(mockClose).not.toHaveBeenCalled()
  })

  it('should render actions and execute enabled actions', async () => {
    const { store } = renderPanelContextmenu({
      initialStoreState: {
        contextMenuTarget: { type: 'panel' },
        clipboardElements: [createNode({ id: 'copied-node' })],
      },
      hooksStoreProps: {},
    })

    expect(await screen.findByText('common.addBlock')).toBeInTheDocument()
    expect(screen.getByText('common.run')).toBeInTheDocument()
    expect(screen.getByText('common.pasteHere')).toBeInTheDocument()

    fireEvent.click(screen.getByText('nodes.note.addNote'))
    fireEvent.click(screen.getByText('common.run'))
    fireEvent.click(screen.getByText('common.pasteHere'))
    fireEvent.click(screen.getByText('export'))
    fireEvent.click(screen.getByText('importApp'))

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
      hooksStoreProps: {
        configsMap: {
          flowId: 'snippet-1',
          flowType: FlowType.snippet,
          fileSettings: {},
        },
      },
    })

    expect(await screen.findByText('export')).toBeInTheDocument()
    expect(screen.queryByText('importApp')).not.toBeInTheDocument()
  })

  it('should render preview action in chat mode', async () => {
    mockUseIsChatMode.mockReturnValue(true)

    renderPanelContextmenu({
      initialStoreState: {
        contextMenuTarget: { type: 'panel' },
      },
      hooksStoreProps: {},
    })

    expect(await screen.findByText('common.debugAndPreview')).toBeInTheDocument()
    expect(screen.queryByText('common.run')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('common.debugAndPreview'))

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

    expect(await screen.findByText('comments.actions.addComment')).toBeInTheDocument()
    expect(screen.queryByText('nodes.note.addNote')).not.toBeInTheDocument()
  })
})
