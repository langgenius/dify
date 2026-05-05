import type { Shape, SliceFromInjection } from '../workflow'
import { renderHook } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { createTestWorkflowStore, renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { createWorkflowStore, useStore, useWorkflowStore } from '../workflow'

function createStore() {
  return createTestWorkflowStore()
}

type SetterKey = keyof Shape & `set${string}`
type StateKey = Exclude<keyof Shape, SetterKey>

/**
 * Verifies a simple setter → state round-trip:
 * calling state[setter](value) should update state[stateKey] to equal value.
 */
function testSetter(setter: SetterKey, stateKey: StateKey, value: Shape[StateKey]) {
  const store = createStore()
  const setFn = store.getState()[setter] as (v: Shape[StateKey]) => void
  setFn(value)
  expect(store.getState()[stateKey]).toEqual(value)
}

const emptyIterParallelLogMap = new Map<string, Map<string, never[]>>()

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
    it.each<[StateKey, SetterKey, Shape[StateKey]]>([
      ['workflowRunningData', 'setWorkflowRunningData', { result: { status: 'running', inputs_truncated: false, process_data_truncated: false, outputs_truncated: false } }],
      ['isListening', 'setIsListening', true],
      ['listeningTriggerType', 'setListeningTriggerType', BlockEnum.TriggerWebhook],
      ['listeningTriggerNodeId', 'setListeningTriggerNodeId', 'node-abc'],
      ['listeningTriggerNodeIds', 'setListeningTriggerNodeIds', ['n1', 'n2']],
      ['listeningTriggerIsAll', 'setListeningTriggerIsAll', true],
      ['clipboardElements', 'setClipboardElements', []],
      ['clipboardEdges', 'setClipboardEdges', []],
      ['selection', 'setSelection', { x1: 0, y1: 0, x2: 100, y2: 100 }],
      ['bundleNodeSize', 'setBundleNodeSize', { width: 200, height: 100 }],
      ['mousePosition', 'setMousePosition', { pageX: 10, pageY: 20, elementX: 5, elementY: 15 }],
      ['showConfirm', 'setShowConfirm', { title: 'Delete?', onConfirm: vi.fn() }],
      ['controlPromptEditorRerenderKey', 'setControlPromptEditorRerenderKey', 42],
      ['showImportDSLModal', 'setShowImportDSLModal', true],
      ['fileUploadConfig', 'setFileUploadConfig', { batch_count_limit: 5, image_file_batch_limit: 10, single_chunk_attachment_limit: 10, attachment_image_file_size_limit: 2, file_size_limit: 15, file_upload_limit: 5 }],
    ])('should update %s', (stateKey, setter, value) => {
      testSetter(setter, stateKey, value)
    })

    it('should persist controlMode to localStorage', () => {
      const store = createStore()
      store.getState().setControlMode('pointer')
      expect(store.getState().controlMode).toBe('pointer')
      expect(localStorage.setItem).toHaveBeenCalledWith('workflow-operation-mode', 'pointer')
    })

    it('should update clipboard nodes and edges with setClipboardData', () => {
      const store = createStore()
      const nodes = [createNode({ id: 'n-1' })]
      const edges = [createEdge({ id: 'e-1', source: 'n-1', target: 'n-2' })]

      store.getState().setClipboardData({ nodes, edges })

      expect(store.getState().clipboardElements).toEqual(nodes)
      expect(store.getState().clipboardEdges).toEqual(edges)
    })
  })

  describe('Node Slice Setters', () => {
    it.each<[StateKey, SetterKey, Shape[StateKey]]>([
      ['showSingleRunPanel', 'setShowSingleRunPanel', true],
      ['nodeAnimation', 'setNodeAnimation', true],
      ['candidateNode', 'setCandidateNode', undefined],
      ['nodeMenu', 'setNodeMenu', { clientX: 200, clientY: 100, nodeId: 'n1' }],
      ['showAssignVariablePopup', 'setShowAssignVariablePopup', undefined],
      ['hoveringAssignVariableGroupId', 'setHoveringAssignVariableGroupId', 'group-1'],
      ['connectingNodePayload', 'setConnectingNodePayload', { nodeId: 'n1', nodeType: 'llm', handleType: 'source', handleId: 'h1' }],
      ['enteringNodePayload', 'setEnteringNodePayload', undefined],
      ['iterTimes', 'setIterTimes', 5],
      ['loopTimes', 'setLoopTimes', 10],
      ['iterParallelLogMap', 'setIterParallelLogMap', emptyIterParallelLogMap],
      ['pendingSingleRun', 'setPendingSingleRun', { nodeId: 'n1', action: 'run' }],
    ])('should update %s', (stateKey, setter, value) => {
      testSetter(setter, stateKey, value)
    })
  })

  describe('Panel Slice Setters', () => {
    it.each<[StateKey, SetterKey, Shape[StateKey]]>([
      ['showFeaturesPanel', 'setShowFeaturesPanel', true],
      ['showWorkflowVersionHistoryPanel', 'setShowWorkflowVersionHistoryPanel', true],
      ['showInputsPanel', 'setShowInputsPanel', true],
      ['showDebugAndPreviewPanel', 'setShowDebugAndPreviewPanel', true],
      ['panelMenu', 'setPanelMenu', { top: 10, left: 20 }],
      ['selectionMenu', 'setSelectionMenu', { clientX: 50, clientY: 60 }],
      ['edgeMenu', 'setEdgeMenu', { clientX: 320, clientY: 180, edgeId: 'e1' }],
      ['showVariableInspectPanel', 'setShowVariableInspectPanel', true],
      ['initShowLastRunTab', 'setInitShowLastRunTab', true],
    ])('should update %s', (stateKey, setter, value) => {
      testSetter(setter, stateKey, value)
    })
  })

  describe('Help Line Slice Setters', () => {
    it.each<[StateKey, SetterKey, Shape[StateKey]]>([
      ['helpLineHorizontal', 'setHelpLineHorizontal', { top: 100, left: 0, width: 500 }],
      ['helpLineVertical', 'setHelpLineVertical', { top: 0, left: 200, height: 300 }],
    ])('should update %s', (stateKey, setter, value) => {
      testSetter(setter, stateKey, value)
    })

    it('should clear helpLineHorizontal', () => {
      const store = createStore()
      store.getState().setHelpLineHorizontal({ top: 100, left: 0, width: 500 })
      store.getState().setHelpLineHorizontal(undefined)
      expect(store.getState().helpLineHorizontal).toBeUndefined()
    })
  })

  describe('History Slice Setters', () => {
    it.each<[StateKey, SetterKey, Shape[StateKey]]>([
      ['historyWorkflowData', 'setHistoryWorkflowData', { id: 'run-1', status: 'succeeded' }],
      ['showRunHistory', 'setShowRunHistory', true],
      ['versionHistory', 'setVersionHistory', []],
    ])('should update %s', (stateKey, setter, value) => {
      testSetter(setter, stateKey, value)
    })
  })

  describe('Form Slice Setters', () => {
    it.each<[StateKey, SetterKey, Shape[StateKey]]>([
      ['inputs', 'setInputs', { name: 'test', count: 42 }],
      ['files', 'setFiles', []],
    ])('should update %s', (stateKey, setter, value) => {
      testSetter(setter, stateKey, value)
    })
  })

  describe('Tool Slice Setters', () => {
    it.each<[StateKey, SetterKey, Shape[StateKey]]>([
      ['toolPublished', 'setToolPublished', true],
      ['lastPublishedHasUserInput', 'setLastPublishedHasUserInput', true],
    ])('should update %s', (stateKey, setter, value) => {
      testSetter(setter, stateKey, value)
    })
  })

  describe('Layout Slice Setters', () => {
    it.each<[StateKey, SetterKey, Shape[StateKey]]>([
      ['workflowCanvasWidth', 'setWorkflowCanvasWidth', 1200],
      ['workflowCanvasHeight', 'setWorkflowCanvasHeight', 800],
      ['rightPanelWidth', 'setRightPanelWidth', 500],
      ['nodePanelWidth', 'setNodePanelWidth', 350],
      ['previewPanelWidth', 'setPreviewPanelWidth', 450],
      ['otherPanelWidth', 'setOtherPanelWidth', 380],
      ['bottomPanelWidth', 'setBottomPanelWidth', 600],
      ['bottomPanelHeight', 'setBottomPanelHeight', 500],
      ['variableInspectPanelHeight', 'setVariableInspectPanelHeight', 250],
      ['maximizeCanvas', 'setMaximizeCanvas', true],
    ])('should update %s', (stateKey, setter, value) => {
      testSetter(setter, stateKey, value)
    })
  })

  describe('localStorage Initialization', () => {
    it('should read controlMode from localStorage', () => {
      localStorage.setItem('workflow-operation-mode', 'pointer')
      const store = createStore()
      expect(store.getState().controlMode).toBe('pointer')
    })

    it('should default controlMode to pointer when localStorage has no value', () => {
      const store = createStore()
      expect(store.getState().controlMode).toBe('pointer')
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
      const { result } = renderWorkflowHook(
        () => useStore(s => s.showSingleRunPanel),
        { initialStoreState: { showSingleRunPanel: true } },
      )
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
      const { result, store } = renderWorkflowHook(() => useWorkflowStore())
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
