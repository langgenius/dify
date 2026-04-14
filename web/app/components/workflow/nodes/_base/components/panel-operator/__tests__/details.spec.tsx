/* eslint-disable ts/no-explicit-any */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import {
  useAvailableBlocks,
  useIsChatMode,
  useNodeDataUpdate,
  useNodeMetaData,
  useNodesInteractions,
  useNodesReadOnly,
  useNodesSyncDraft,
} from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAllWorkflowTools } from '@/service/use-tools'
import { FlowType } from '@/types/common'
import ChangeBlock from '../change-block'
import PanelOperatorPopup from '../panel-operator-popup'

vi.mock('@/app/components/workflow/block-selector', () => ({
  default: ({ trigger, onSelect, availableBlocksTypes, showStartTab, ignoreNodeIds, forceEnableStartTab, allowUserInputSelection }: any) => (
    <div>
      <div>{trigger()}</div>
      <div>{`available:${(availableBlocksTypes || []).join(',')}`}</div>
      <div>{`show-start:${String(showStartTab)}`}</div>
      <div>{`ignore:${(ignoreNodeIds || []).join(',')}`}</div>
      <div>{`force-start:${String(forceEnableStartTab)}`}</div>
      <div>{`allow-start:${String(allowUserInputSelection)}`}</div>
      <button type="button" onClick={() => onSelect(BlockEnum.HttpRequest)}>select-http</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/hooks')>()
  return {
    ...actual,
    useAvailableBlocks: vi.fn(),
    useIsChatMode: vi.fn(),
    useNodeDataUpdate: vi.fn(),
    useNodeMetaData: vi.fn(),
    useNodesInteractions: vi.fn(),
    useNodesReadOnly: vi.fn(),
    useNodesSyncDraft: vi.fn(),
  }
})

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: vi.fn(),
}))

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  default: vi.fn(),
}))

vi.mock('@/service/use-tools', () => ({
  useAllWorkflowTools: vi.fn(),
}))

const mockUseAvailableBlocks = vi.mocked(useAvailableBlocks)
const mockUseIsChatMode = vi.mocked(useIsChatMode)
const mockUseNodeDataUpdate = vi.mocked(useNodeDataUpdate)
const mockUseNodeMetaData = vi.mocked(useNodeMetaData)
const mockUseNodesInteractions = vi.mocked(useNodesInteractions)
const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseNodesSyncDraft = vi.mocked(useNodesSyncDraft)
const mockUseHooksStore = vi.mocked(useHooksStore)
const mockUseNodes = vi.mocked(useNodes)
const mockUseAllWorkflowTools = vi.mocked(useAllWorkflowTools)

describe('panel-operator details', () => {
  const handleNodeChange = vi.fn()
  const handleNodeDelete = vi.fn()
  const handleNodesDuplicate = vi.fn()
  const handleNodeSelect = vi.fn()
  const handleNodesCopy = vi.fn()
  const handleNodeDataUpdate = vi.fn()
  const handleSyncWorkflowDraft = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAvailableBlocks.mockReturnValue({
      getAvailableBlocks: vi.fn(() => ({
        availablePrevBlocks: [BlockEnum.HttpRequest],
        availableNextBlocks: [BlockEnum.HttpRequest],
      })),
      availablePrevBlocks: [BlockEnum.HttpRequest],
      availableNextBlocks: [BlockEnum.HttpRequest],
    } as ReturnType<typeof useAvailableBlocks>)
    mockUseIsChatMode.mockReturnValue(false)
    mockUseNodeDataUpdate.mockReturnValue({
      handleNodeDataUpdate,
      handleNodeDataUpdateWithSyncDraft: vi.fn(),
    })
    mockUseNodeMetaData.mockReturnValue({
      isTypeFixed: false,
      isSingleton: false,
      isUndeletable: false,
      description: 'Node description',
      author: 'Dify',
      helpLinkUri: 'https://docs.example.com/node',
    } as ReturnType<typeof useNodeMetaData>)
    mockUseNodesInteractions.mockReturnValue({
      handleNodeChange,
      handleNodeDelete,
      handleNodesDuplicate,
      handleNodeSelect,
      handleNodesCopy,
    } as unknown as ReturnType<typeof useNodesInteractions>)
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false } as ReturnType<typeof useNodesReadOnly>)
    mockUseNodesSyncDraft.mockReturnValue({
      doSyncWorkflowDraft: vi.fn(),
      handleSyncWorkflowDraft,
      syncWorkflowDraftWhenPageClose: vi.fn(),
    } as ReturnType<typeof useNodesSyncDraft>)
    mockUseHooksStore.mockImplementation((selector: any) => selector({ configsMap: { flowType: FlowType.appFlow } }))
    mockUseNodes.mockReturnValue([{ id: 'start', position: { x: 0, y: 0 }, data: { type: BlockEnum.Start } as any }] as any)
    mockUseAllWorkflowTools.mockReturnValue({ data: [] } as any)
  })

  // The panel operator internals should expose block-change and popup actions using the real workflow popup composition.
  describe('Internal Actions', () => {
    it('should select a replacement block through ChangeBlock', async () => {
      const user = userEvent.setup()
      render(
        <ChangeBlock
          nodeId="node-1"
          nodeData={{ type: BlockEnum.Code } as any}
          sourceHandle="source"
        />,
      )

      await user.click(screen.getByText('select-http'))

      expect(screen.getByText('available:http-request')).toBeInTheDocument()
      expect(screen.getByText('show-start:true')).toBeInTheDocument()
      expect(screen.getByText('ignore:')).toBeInTheDocument()
      expect(screen.getByText('force-start:false')).toBeInTheDocument()
      expect(screen.getByText('allow-start:false')).toBeInTheDocument()
      expect(handleNodeChange).toHaveBeenCalledWith('node-1', BlockEnum.HttpRequest, 'source', undefined)
    })

    it('should expose trigger and start-node specific block selector options', () => {
      mockUseAvailableBlocks.mockReturnValueOnce({
        getAvailableBlocks: vi.fn(() => ({
          availablePrevBlocks: [],
          availableNextBlocks: [BlockEnum.HttpRequest],
        })),
        availablePrevBlocks: [],
        availableNextBlocks: [BlockEnum.HttpRequest],
      } as ReturnType<typeof useAvailableBlocks>)
      mockUseIsChatMode.mockReturnValueOnce(true)
      mockUseHooksStore.mockImplementationOnce((selector: any) => selector({ configsMap: { flowType: FlowType.appFlow } }))
      mockUseNodes.mockReturnValueOnce([] as any)

      const { rerender } = render(
        <ChangeBlock
          nodeId="trigger-node"
          nodeData={{ type: BlockEnum.TriggerWebhook } as any}
          sourceHandle="source"
        />,
      )

      expect(screen.getByText('available:http-request')).toBeInTheDocument()
      expect(screen.getByText('show-start:true')).toBeInTheDocument()
      expect(screen.getByText('ignore:trigger-node')).toBeInTheDocument()
      expect(screen.getByText('allow-start:true')).toBeInTheDocument()

      mockUseAvailableBlocks.mockReturnValueOnce({
        getAvailableBlocks: vi.fn(() => ({
          availablePrevBlocks: [BlockEnum.Code],
          availableNextBlocks: [],
        })),
        availablePrevBlocks: [BlockEnum.Code],
        availableNextBlocks: [],
      } as ReturnType<typeof useAvailableBlocks>)
      mockUseHooksStore.mockImplementationOnce((selector: any) => selector({ configsMap: { flowType: FlowType.ragPipeline } }))
      mockUseNodes.mockReturnValueOnce([{ id: 'start', position: { x: 0, y: 0 }, data: { type: BlockEnum.Start } as any }] as any)

      rerender(
        <ChangeBlock
          nodeId="start-node"
          nodeData={{ type: BlockEnum.Start } as any}
          sourceHandle="source"
        />,
      )

      expect(screen.getByText('available:code')).toBeInTheDocument()
      expect(screen.getByText('show-start:false')).toBeInTheDocument()
      expect(screen.getByText('ignore:start-node')).toBeInTheDocument()
      expect(screen.getByText('force-start:true')).toBeInTheDocument()
    })

    it('should run, copy, duplicate, delete, and expose the help link in the popup', async () => {
      const user = userEvent.setup()
      renderWorkflowFlowComponent(
        <PanelOperatorPopup
          id="node-1"
          data={{ type: BlockEnum.Code, title: 'Code Node', desc: '' } as any}
          onClosePopup={vi.fn()}
          showHelpLink
        />,
        {
          nodes: [],
          edges: [{ id: 'edge-1', source: 'node-0', target: 'node-1', sourceHandle: 'branch-a' }],
        },
      )

      await user.click(screen.getByText('workflow.panel.runThisStep'))
      await user.click(screen.getByText('workflow.common.copy'))
      await user.click(screen.getByText('workflow.common.duplicate'))
      await user.click(screen.getByText('common.operation.delete'))

      expect(handleNodeSelect).toHaveBeenCalledWith('node-1')
      expect(handleNodeDataUpdate).toHaveBeenCalledWith({ id: 'node-1', data: { _isSingleRun: true } })
      expect(handleSyncWorkflowDraft).toHaveBeenCalledWith(true)
      expect(handleNodesCopy).toHaveBeenCalledWith('node-1')
      expect(handleNodesDuplicate).toHaveBeenCalledWith('node-1')
      expect(handleNodeDelete).toHaveBeenCalledWith('node-1')
      expect(screen.getByRole('link', { name: 'workflow.panel.helpLink' })).toHaveAttribute('href', 'https://docs.example.com/node')
    })

    it('should hide change action when node is undeletable', () => {
      mockUseNodeMetaData.mockReturnValueOnce({
        isTypeFixed: false,
        isSingleton: true,
        isUndeletable: true,
        description: 'Undeletable node',
        author: 'Dify',
      } as ReturnType<typeof useNodeMetaData>)

      renderWorkflowFlowComponent(
        <PanelOperatorPopup
          id="node-4"
          data={{ type: BlockEnum.Code, title: 'Undeletable node', desc: '' } as any}
          onClosePopup={vi.fn()}
          showHelpLink={false}
        />,
        {
          nodes: [],
          edges: [],
        },
      )

      expect(screen.getByText('workflow.panel.runThisStep')).toBeInTheDocument()
      expect(screen.queryByText('workflow.panel.change')).not.toBeInTheDocument()
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })

    it('should render workflow-tool and readonly popup variants', () => {
      mockUseAllWorkflowTools.mockReturnValueOnce({
        data: [{ id: 'workflow-tool', workflow_app_id: 'app-123' }],
      } as any)

      const { rerender } = renderWorkflowFlowComponent(
        <PanelOperatorPopup
          id="node-2"
          data={{ type: BlockEnum.Tool, title: 'Workflow Tool', desc: '', provider_type: 'workflow', provider_id: 'workflow-tool' } as any}
          onClosePopup={vi.fn()}
          showHelpLink={false}
        />,
        {
          nodes: [],
          edges: [],
        },
      )

      expect(screen.getByRole('link', { name: 'workflow.panel.openWorkflow' })).toHaveAttribute('href', '/app/app-123/workflow')

      mockUseNodesReadOnly.mockReturnValueOnce({ nodesReadOnly: true } as ReturnType<typeof useNodesReadOnly>)
      mockUseNodeMetaData.mockReturnValueOnce({
        isTypeFixed: true,
        isSingleton: true,
        isUndeletable: true,
        description: 'Read only node',
        author: 'Dify',
      } as ReturnType<typeof useNodeMetaData>)

      rerender(
        <PanelOperatorPopup
          id="node-3"
          data={{ type: BlockEnum.End, title: 'Read only node', desc: '' } as any}
          onClosePopup={vi.fn()}
          showHelpLink={false}
        />,
      )

      expect(screen.queryByText('workflow.panel.runThisStep')).not.toBeInTheDocument()
      expect(screen.queryByText('workflow.common.copy')).not.toBeInTheDocument()
      expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    })
  })
})
