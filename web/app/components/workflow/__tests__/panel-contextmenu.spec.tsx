import { fireEvent, screen, waitFor } from '@testing-library/react'
import PanelContextmenu from '../panel-contextmenu'
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
  const mockHandlePaneContextmenuCancel = vi.fn()
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
      t: (key: string) => key,
    })
    mockUseNodesInteractions.mockReturnValue({
      handleNodesPaste: mockHandleNodesPaste,
    })
    mockUsePanelInteractions.mockReturnValue({
      handlePaneContextmenuCancel: mockHandlePaneContextmenuCancel,
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

  it('should stay hidden when the panel menu is absent', () => {
    renderWorkflowFlowComponent(<PanelContextmenu />)

    expect(screen.queryByText('common.addBlock')).not.toBeInTheDocument()
  })

  it('should keep paste disabled when the clipboard is empty', async () => {
    renderWorkflowFlowComponent(<PanelContextmenu />, {
      initialStoreState: {
        panelMenu: { clientX: 24, clientY: 48 },
      },
      hooksStoreProps: {},
    })

    await screen.findByText('common.pasteHere')
    fireEvent.click(screen.getByText('common.pasteHere'))

    expect(mockHandleNodesPaste).not.toHaveBeenCalled()
    expect(mockHandlePaneContextmenuCancel).not.toHaveBeenCalled()
  })

  it('should render actions and execute enabled actions', async () => {
    const { store } = renderWorkflowFlowComponent(<PanelContextmenu />, {
      initialStoreState: {
        panelMenu: { clientX: 24, clientY: 48 },
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

  it('should render preview action in chat mode', async () => {
    mockUseIsChatMode.mockReturnValue(true)

    renderWorkflowFlowComponent(<PanelContextmenu />, {
      initialStoreState: {
        panelMenu: { clientX: 24, clientY: 48 },
      },
      hooksStoreProps: {},
    })

    expect(await screen.findByText('common.debugAndPreview')).toBeInTheDocument()
    expect(screen.queryByText('common.run')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('common.debugAndPreview'))

    await waitFor(() => {
      expect(mockHandleWorkflowStartRunInChatflow).toHaveBeenCalledTimes(1)
      expect(mockHandleStartWorkflowRun).not.toHaveBeenCalled()
      expect(mockHandlePaneContextmenuCancel).toHaveBeenCalled()
    })
  })
})
