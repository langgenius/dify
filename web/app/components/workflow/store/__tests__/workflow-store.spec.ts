import type { Shape, SliceFromInjection } from '../workflow'
import type { HelpLineHorizontalPosition, HelpLineVerticalPosition } from '@/app/components/workflow/help-line/types'
import type { WorkflowRunningData } from '@/app/components/workflow/types'
import type { FileUploadConfigResponse } from '@/models/common'
import type { VersionHistory } from '@/types/workflow'
import { renderHook } from '@testing-library/react'
import * as React from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { WorkflowContext } from '../../context'
import { createWorkflowStore, useStore, useWorkflowStore } from '../workflow'

function createStore() {
  return createWorkflowStore({})
}

describe('createWorkflowStore', () => {
  describe('Initial State', () => {
    it('should create a store with all slices merged', () => {
      const store = createStore()
      const state = store.getState()

      expect(state.showSingleRunPanel).toBe(false)
      expect(state.controlMode).toBeDefined()
      expect(state.nodes).toEqual([])
      expect(state.environmentVariables).toEqual([])
      expect(state.conversationVariables).toEqual([])
      expect(state.nodesWithInspectVars).toEqual([])
      expect(state.workflowCanvasWidth).toBeUndefined()
      expect(state.draftUpdatedAt).toBe(0)
      expect(state.versionHistory).toEqual([])
    })
  })

  describe('Workflow Slice Setters', () => {
    it('should update workflowRunningData', () => {
      const store = createStore()
      const data: Partial<WorkflowRunningData> = { result: { status: 'running', inputs_truncated: false, process_data_truncated: false, outputs_truncated: false } }
      store.getState().setWorkflowRunningData(data as Parameters<Shape['setWorkflowRunningData']>[0])
      expect(store.getState().workflowRunningData).toEqual(data)
    })

    it('should update isListening', () => {
      const store = createStore()
      store.getState().setIsListening(true)
      expect(store.getState().isListening).toBe(true)
    })

    it('should update listeningTriggerType', () => {
      const store = createStore()
      store.getState().setListeningTriggerType(BlockEnum.TriggerWebhook)
      expect(store.getState().listeningTriggerType).toBe(BlockEnum.TriggerWebhook)
    })

    it('should update listeningTriggerNodeId', () => {
      const store = createStore()
      store.getState().setListeningTriggerNodeId('node-abc')
      expect(store.getState().listeningTriggerNodeId).toBe('node-abc')
    })

    it('should update listeningTriggerNodeIds', () => {
      const store = createStore()
      store.getState().setListeningTriggerNodeIds(['n1', 'n2'])
      expect(store.getState().listeningTriggerNodeIds).toEqual(['n1', 'n2'])
    })

    it('should update listeningTriggerIsAll', () => {
      const store = createStore()
      store.getState().setListeningTriggerIsAll(true)
      expect(store.getState().listeningTriggerIsAll).toBe(true)
    })

    it('should update clipboardElements', () => {
      const store = createStore()
      store.getState().setClipboardElements([])
      expect(store.getState().clipboardElements).toEqual([])
    })

    it('should update selection', () => {
      const store = createStore()
      const sel = { x1: 0, y1: 0, x2: 100, y2: 100 }
      store.getState().setSelection(sel)
      expect(store.getState().selection).toEqual(sel)
    })

    it('should update bundleNodeSize', () => {
      const store = createStore()
      store.getState().setBundleNodeSize({ width: 200, height: 100 })
      expect(store.getState().bundleNodeSize).toEqual({ width: 200, height: 100 })
    })

    it('should persist controlMode to localStorage', () => {
      const store = createStore()
      store.getState().setControlMode('pointer')
      expect(store.getState().controlMode).toBe('pointer')
      expect(localStorage.setItem).toHaveBeenCalledWith('workflow-operation-mode', 'pointer')
    })

    it('should update mousePosition', () => {
      const store = createStore()
      const pos = { pageX: 10, pageY: 20, elementX: 5, elementY: 15 }
      store.getState().setMousePosition(pos)
      expect(store.getState().mousePosition).toEqual(pos)
    })

    it('should update showConfirm', () => {
      const store = createStore()
      const confirm = { title: 'Delete?', onConfirm: vi.fn() }
      store.getState().setShowConfirm(confirm)
      expect(store.getState().showConfirm).toEqual(confirm)
    })

    it('should update controlPromptEditorRerenderKey', () => {
      const store = createStore()
      store.getState().setControlPromptEditorRerenderKey(42)
      expect(store.getState().controlPromptEditorRerenderKey).toBe(42)
    })

    it('should update showImportDSLModal', () => {
      const store = createStore()
      store.getState().setShowImportDSLModal(true)
      expect(store.getState().showImportDSLModal).toBe(true)
    })

    it('should update fileUploadConfig', () => {
      const store = createStore()
      const config: FileUploadConfigResponse = {
        batch_count_limit: 5,
        image_file_batch_limit: 10,
        single_chunk_attachment_limit: 10,
        attachment_image_file_size_limit: 2,
        file_size_limit: 15,
        file_upload_limit: 5,
      }
      store.getState().setFileUploadConfig(config)
      expect(store.getState().fileUploadConfig).toEqual(config)
    })
  })

  describe('Node Slice Setters', () => {
    it('should update showSingleRunPanel', () => {
      const store = createStore()
      store.getState().setShowSingleRunPanel(true)
      expect(store.getState().showSingleRunPanel).toBe(true)
    })

    it('should update nodeAnimation', () => {
      const store = createStore()
      store.getState().setNodeAnimation(true)
      expect(store.getState().nodeAnimation).toBe(true)
    })

    it('should update candidateNode', () => {
      const store = createStore()
      store.getState().setCandidateNode(undefined)
      expect(store.getState().candidateNode).toBeUndefined()
    })

    it('should update nodeMenu', () => {
      const store = createStore()
      store.getState().setNodeMenu({ top: 100, left: 200, nodeId: 'n1' })
      expect(store.getState().nodeMenu).toEqual({ top: 100, left: 200, nodeId: 'n1' })
    })

    it('should update showAssignVariablePopup', () => {
      const store = createStore()
      store.getState().setShowAssignVariablePopup(undefined)
      expect(store.getState().showAssignVariablePopup).toBeUndefined()
    })

    it('should update hoveringAssignVariableGroupId', () => {
      const store = createStore()
      store.getState().setHoveringAssignVariableGroupId('group-1')
      expect(store.getState().hoveringAssignVariableGroupId).toBe('group-1')
    })

    it('should update connectingNodePayload', () => {
      const store = createStore()
      const payload = { nodeId: 'n1', nodeType: 'llm', handleType: 'source', handleId: 'h1' }
      store.getState().setConnectingNodePayload(payload)
      expect(store.getState().connectingNodePayload).toEqual(payload)
    })

    it('should update enteringNodePayload', () => {
      const store = createStore()
      store.getState().setEnteringNodePayload(undefined)
      expect(store.getState().enteringNodePayload).toBeUndefined()
    })

    it('should update iterTimes', () => {
      const store = createStore()
      store.getState().setIterTimes(5)
      expect(store.getState().iterTimes).toBe(5)
    })

    it('should update loopTimes', () => {
      const store = createStore()
      store.getState().setLoopTimes(10)
      expect(store.getState().loopTimes).toBe(10)
    })

    it('should update iterParallelLogMap', () => {
      const store = createStore()
      const map = new Map<string, Map<string, never[]>>()
      store.getState().setIterParallelLogMap(map)
      expect(store.getState().iterParallelLogMap).toBe(map)
    })

    it('should update pendingSingleRun', () => {
      const store = createStore()
      store.getState().setPendingSingleRun({ nodeId: 'n1', action: 'run' })
      expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'n1', action: 'run' })
    })
  })

  describe('Panel Slice Setters', () => {
    it('should update showFeaturesPanel', () => {
      const store = createStore()
      store.getState().setShowFeaturesPanel(true)
      expect(store.getState().showFeaturesPanel).toBe(true)
    })

    it('should update showWorkflowVersionHistoryPanel', () => {
      const store = createStore()
      store.getState().setShowWorkflowVersionHistoryPanel(true)
      expect(store.getState().showWorkflowVersionHistoryPanel).toBe(true)
    })

    it('should update showInputsPanel', () => {
      const store = createStore()
      store.getState().setShowInputsPanel(true)
      expect(store.getState().showInputsPanel).toBe(true)
    })

    it('should update showDebugAndPreviewPanel', () => {
      const store = createStore()
      store.getState().setShowDebugAndPreviewPanel(true)
      expect(store.getState().showDebugAndPreviewPanel).toBe(true)
    })

    it('should update panelMenu', () => {
      const store = createStore()
      store.getState().setPanelMenu({ top: 10, left: 20 })
      expect(store.getState().panelMenu).toEqual({ top: 10, left: 20 })
    })

    it('should update selectionMenu', () => {
      const store = createStore()
      store.getState().setSelectionMenu({ top: 50, left: 60 })
      expect(store.getState().selectionMenu).toEqual({ top: 50, left: 60 })
    })

    it('should update showVariableInspectPanel', () => {
      const store = createStore()
      store.getState().setShowVariableInspectPanel(true)
      expect(store.getState().showVariableInspectPanel).toBe(true)
    })

    it('should update initShowLastRunTab', () => {
      const store = createStore()
      store.getState().setInitShowLastRunTab(true)
      expect(store.getState().initShowLastRunTab).toBe(true)
    })
  })

  describe('Help Line Slice Setters', () => {
    it('should update helpLineHorizontal', () => {
      const store = createStore()
      const pos: HelpLineHorizontalPosition = { top: 100, left: 0, width: 500 }
      store.getState().setHelpLineHorizontal(pos)
      expect(store.getState().helpLineHorizontal).toEqual(pos)
    })

    it('should clear helpLineHorizontal', () => {
      const store = createStore()
      store.getState().setHelpLineHorizontal({ top: 100, left: 0, width: 500 })
      store.getState().setHelpLineHorizontal(undefined)
      expect(store.getState().helpLineHorizontal).toBeUndefined()
    })

    it('should update helpLineVertical', () => {
      const store = createStore()
      const pos: HelpLineVerticalPosition = { top: 0, left: 200, height: 300 }
      store.getState().setHelpLineVertical(pos)
      expect(store.getState().helpLineVertical).toEqual(pos)
    })
  })

  describe('History Slice Setters', () => {
    it('should update historyWorkflowData', () => {
      const store = createStore()
      store.getState().setHistoryWorkflowData({ id: 'run-1', status: 'succeeded' })
      expect(store.getState().historyWorkflowData).toEqual({ id: 'run-1', status: 'succeeded' })
    })

    it('should update showRunHistory', () => {
      const store = createStore()
      store.getState().setShowRunHistory(true)
      expect(store.getState().showRunHistory).toBe(true)
    })

    it('should update versionHistory', () => {
      const store = createStore()
      const history: VersionHistory[] = []
      store.getState().setVersionHistory(history)
      expect(store.getState().versionHistory).toEqual(history)
    })
  })

  describe('Form Slice Setters', () => {
    it('should update inputs', () => {
      const store = createStore()
      store.getState().setInputs({ name: 'test', count: 42 })
      expect(store.getState().inputs).toEqual({ name: 'test', count: 42 })
    })

    it('should update files', () => {
      const store = createStore()
      store.getState().setFiles([])
      expect(store.getState().files).toEqual([])
    })
  })

  describe('Tool Slice Setters', () => {
    it('should update toolPublished', () => {
      const store = createStore()
      store.getState().setToolPublished(true)
      expect(store.getState().toolPublished).toBe(true)
    })

    it('should update lastPublishedHasUserInput', () => {
      const store = createStore()
      store.getState().setLastPublishedHasUserInput(true)
      expect(store.getState().lastPublishedHasUserInput).toBe(true)
    })
  })

  describe('Layout Slice Setters', () => {
    it('should update workflowCanvasWidth', () => {
      const store = createStore()
      store.getState().setWorkflowCanvasWidth(1200)
      expect(store.getState().workflowCanvasWidth).toBe(1200)
    })

    it('should update workflowCanvasHeight', () => {
      const store = createStore()
      store.getState().setWorkflowCanvasHeight(800)
      expect(store.getState().workflowCanvasHeight).toBe(800)
    })

    it('should update rightPanelWidth', () => {
      const store = createStore()
      store.getState().setRightPanelWidth(500)
      expect(store.getState().rightPanelWidth).toBe(500)
    })

    it('should update nodePanelWidth', () => {
      const store = createStore()
      store.getState().setNodePanelWidth(350)
      expect(store.getState().nodePanelWidth).toBe(350)
    })

    it('should update previewPanelWidth', () => {
      const store = createStore()
      store.getState().setPreviewPanelWidth(450)
      expect(store.getState().previewPanelWidth).toBe(450)
    })

    it('should update otherPanelWidth', () => {
      const store = createStore()
      store.getState().setOtherPanelWidth(380)
      expect(store.getState().otherPanelWidth).toBe(380)
    })

    it('should update bottomPanelWidth', () => {
      const store = createStore()
      store.getState().setBottomPanelWidth(600)
      expect(store.getState().bottomPanelWidth).toBe(600)
    })

    it('should update bottomPanelHeight', () => {
      const store = createStore()
      store.getState().setBottomPanelHeight(500)
      expect(store.getState().bottomPanelHeight).toBe(500)
    })

    it('should update variableInspectPanelHeight', () => {
      const store = createStore()
      store.getState().setVariableInspectPanelHeight(250)
      expect(store.getState().variableInspectPanelHeight).toBe(250)
    })

    it('should update maximizeCanvas', () => {
      const store = createStore()
      store.getState().setMaximizeCanvas(true)
      expect(store.getState().maximizeCanvas).toBe(true)
    })
  })

  describe('localStorage Initialization', () => {
    it('should read controlMode from localStorage', () => {
      localStorage.setItem('workflow-operation-mode', 'pointer')
      const store = createStore()
      expect(store.getState().controlMode).toBe('pointer')
    })

    it('should default controlMode to hand when localStorage has no value', () => {
      const store = createStore()
      expect(store.getState().controlMode).toBe('hand')
    })

    it('should read panelWidth from localStorage', () => {
      localStorage.setItem('workflow-node-panel-width', '500')
      const store = createStore()
      expect(store.getState().panelWidth).toBe(500)
    })

    it('should default panelWidth to 420 when localStorage is empty', () => {
      const store = createStore()
      expect(store.getState().panelWidth).toBe(420)
    })

    it('should read nodePanelWidth from localStorage', () => {
      localStorage.setItem('workflow-node-panel-width', '350')
      const store = createStore()
      expect(store.getState().nodePanelWidth).toBe(350)
    })

    it('should read previewPanelWidth from localStorage', () => {
      localStorage.setItem('debug-and-preview-panel-width', '450')
      const store = createStore()
      expect(store.getState().previewPanelWidth).toBe(450)
    })

    it('should read variableInspectPanelHeight from localStorage', () => {
      localStorage.setItem('workflow-variable-inpsect-panel-height', '200')
      const store = createStore()
      expect(store.getState().variableInspectPanelHeight).toBe(200)
    })

    it('should read maximizeCanvas from localStorage', () => {
      localStorage.setItem('workflow-canvas-maximize', 'true')
      const store = createStore()
      expect(store.getState().maximizeCanvas).toBe(true)
    })
  })

  describe('useStore hook', () => {
    it('should read state via selector when wrapped in WorkflowContext', () => {
      const store = createStore()
      store.getState().setShowSingleRunPanel(true)

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(WorkflowContext.Provider, { value: store }, children)

      const { result } = renderHook(() => useStore(s => s.showSingleRunPanel), { wrapper })
      expect(result.current).toBe(true)
    })

    it('should throw when used without WorkflowContext.Provider', () => {
      expect(() => {
        renderHook(() => useStore(s => s.showSingleRunPanel))
      }).toThrow('Missing WorkflowContext.Provider in the tree')
    })
  })

  describe('useWorkflowStore hook', () => {
    it('should return the store instance when wrapped in WorkflowContext', () => {
      const store = createStore()
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(WorkflowContext.Provider, { value: store }, children)

      const { result } = renderHook(() => useWorkflowStore(), { wrapper })
      expect(result.current).toBe(store)
    })
  })

  describe('Injection', () => {
    it('should support injecting additional slice', () => {
      const injected: SliceFromInjection = {}
      const store = createWorkflowStore({
        injectWorkflowStoreSliceFn: () => injected,
      })
      expect(store.getState()).toBeDefined()
    })
  })
})
