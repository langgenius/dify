import type { ControlMode, Node } from '../types'
import { noop } from 'es-toolkit'
import { DEFAULT_ITER_TIMES, DEFAULT_LOOP_TIMES } from '../constants'

/**
 * Default workflow store state covering all slices.
 * Use `createWorkflowStoreState(overrides)` to get a state object
 * that can be injected via `useWorkflowStore.setState(...)` or
 * used as the return value of a mocked `useStore` selector.
 */
export function createWorkflowStoreState(overrides: Record<string, unknown> = {}) {
  return {
    // --- workflow-slice ---
    workflowRunningData: undefined,
    isListening: false,
    listeningTriggerType: null,
    listeningTriggerNodeId: null,
    listeningTriggerNodeIds: [],
    listeningTriggerIsAll: false,
    clipboardElements: [] as Node[],
    selection: null,
    bundleNodeSize: null,
    controlMode: 'pointer' as ControlMode,
    mousePosition: { pageX: 0, pageY: 0, elementX: 0, elementY: 0 },
    showConfirm: undefined,
    controlPromptEditorRerenderKey: 0,
    showImportDSLModal: false,
    fileUploadConfig: undefined,

    // --- node-slice ---
    showSingleRunPanel: false,
    nodeAnimation: false,
    candidateNode: undefined,
    nodeMenu: undefined,
    showAssignVariablePopup: undefined,
    hoveringAssignVariableGroupId: undefined,
    connectingNodePayload: undefined,
    enteringNodePayload: undefined,
    iterTimes: DEFAULT_ITER_TIMES,
    loopTimes: DEFAULT_LOOP_TIMES,
    iterParallelLogMap: new Map(),
    pendingSingleRun: undefined,

    // --- panel-slice ---
    panelWidth: 420,
    showFeaturesPanel: false,
    showWorkflowVersionHistoryPanel: false,
    showInputsPanel: false,
    showDebugAndPreviewPanel: false,
    panelMenu: undefined,
    selectionMenu: undefined,
    showVariableInspectPanel: false,
    initShowLastRunTab: false,

    // --- help-line-slice ---
    helpLineHorizontal: undefined,
    helpLineVertical: undefined,

    // --- history-slice ---
    historyWorkflowData: undefined,
    showRunHistory: false,
    versionHistory: [],

    // --- chat-variable-slice ---
    showChatVariablePanel: false,
    showGlobalVariablePanel: false,
    conversationVariables: [],

    // --- env-variable-slice ---
    showEnvPanel: false,
    environmentVariables: [],
    envSecrets: {},

    // --- form-slice ---
    inputs: {},
    files: [],

    // --- tool-slice ---
    toolPublished: false,
    lastPublishedHasUserInput: false,
    buildInTools: undefined,
    customTools: undefined,
    workflowTools: undefined,
    mcpTools: undefined,

    // --- version-slice ---
    draftUpdatedAt: 0,
    publishedAt: 0,
    currentVersion: null,
    isRestoring: false,

    // --- workflow-draft-slice ---
    backupDraft: undefined,
    syncWorkflowDraftHash: '',
    isSyncingWorkflowDraft: false,
    isWorkflowDataLoaded: false,
    nodes: [] as Node[],

    // --- inspect-vars-slice ---
    currentFocusNodeId: null,
    nodesWithInspectVars: [],
    conversationVars: [],

    // --- layout-slice ---
    workflowCanvasWidth: undefined,
    workflowCanvasHeight: undefined,
    rightPanelWidth: undefined,
    nodePanelWidth: 420,
    previewPanelWidth: 420,
    otherPanelWidth: 420,
    bottomPanelWidth: 0,
    bottomPanelHeight: 0,
    variableInspectPanelHeight: 300,
    maximizeCanvas: false,

    // --- setters (all default to noop, override as needed) ---
    setWorkflowRunningData: noop,
    setIsListening: noop,
    setListeningTriggerType: noop,
    setListeningTriggerNodeId: noop,
    setListeningTriggerNodeIds: noop,
    setListeningTriggerIsAll: noop,
    setClipboardElements: noop,
    setSelection: noop,
    setBundleNodeSize: noop,
    setControlMode: noop,
    setMousePosition: noop,
    setShowConfirm: noop,
    setControlPromptEditorRerenderKey: noop,
    setShowImportDSLModal: noop,
    setFileUploadConfig: noop,
    setShowSingleRunPanel: noop,
    setNodeAnimation: noop,
    setCandidateNode: noop,
    setNodeMenu: noop,
    setShowAssignVariablePopup: noop,
    setHoveringAssignVariableGroupId: noop,
    setConnectingNodePayload: noop,
    setEnteringNodePayload: noop,
    setIterTimes: noop,
    setLoopTimes: noop,
    setIterParallelLogMap: noop,
    setPendingSingleRun: noop,
    setShowFeaturesPanel: noop,
    setShowWorkflowVersionHistoryPanel: noop,
    setShowInputsPanel: noop,
    setShowDebugAndPreviewPanel: noop,
    setPanelMenu: noop,
    setSelectionMenu: noop,
    setShowVariableInspectPanel: noop,
    setInitShowLastRunTab: noop,
    setHelpLineHorizontal: noop,
    setHelpLineVertical: noop,
    setHistoryWorkflowData: noop,
    setShowRunHistory: noop,
    setVersionHistory: noop,
    setShowChatVariablePanel: noop,
    setShowGlobalVariablePanel: noop,
    setConversationVariables: noop,
    setShowEnvPanel: noop,
    setEnvironmentVariables: noop,
    setEnvSecrets: noop,
    setInputs: noop,
    setFiles: noop,
    setToolPublished: noop,
    setLastPublishedHasUserInput: noop,
    setDraftUpdatedAt: noop,
    setPublishedAt: noop,
    setCurrentVersion: noop,
    setIsRestoring: noop,
    setBackupDraft: noop,
    setSyncWorkflowDraftHash: noop,
    setIsSyncingWorkflowDraft: noop,
    setIsWorkflowDataLoaded: noop,
    setNodes: noop,
    flushPendingSync: noop,
    setCurrentFocusNodeId: noop,
    setNodesWithInspectVars: noop,
    setNodeInspectVars: noop,
    deleteAllInspectVars: noop,
    deleteNodeInspectVars: noop,
    setInspectVarValue: noop,
    resetToLastRunVar: noop,
    renameInspectVarName: noop,
    deleteInspectVar: noop,
    setWorkflowCanvasWidth: noop,
    setWorkflowCanvasHeight: noop,
    setRightPanelWidth: noop,
    setNodePanelWidth: noop,
    setPreviewPanelWidth: noop,
    setOtherPanelWidth: noop,
    setBottomPanelWidth: noop,
    setBottomPanelHeight: noop,
    setVariableInspectPanelHeight: noop,
    setMaximizeCanvas: noop,

    ...overrides,
  }
}
