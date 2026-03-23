import { noop } from 'es-toolkit'

/**
 * Default hooks store state.
 * All function fields default to noop / vi.fn() stubs.
 * Use `createHooksStoreState(overrides)` to get a customised state object.
 */
export function createHooksStoreState(overrides: Record<string, unknown> = {}) {
  return {
    refreshAll: noop,

    // draft sync
    doSyncWorkflowDraft: vi.fn().mockResolvedValue(undefined),
    syncWorkflowDraftWhenPageClose: noop,
    handleRefreshWorkflowDraft: noop,
    handleBackupDraft: noop,
    handleLoadBackupDraft: noop,
    handleRestoreFromPublishedWorkflow: noop,

    // run
    handleRun: noop,
    handleStopRun: noop,
    handleStartWorkflowRun: noop,
    handleWorkflowStartRunInWorkflow: noop,
    handleWorkflowStartRunInChatflow: noop,
    handleWorkflowTriggerScheduleRunInWorkflow: noop,
    handleWorkflowTriggerWebhookRunInWorkflow: noop,
    handleWorkflowTriggerPluginRunInWorkflow: noop,
    handleWorkflowRunAllTriggersInWorkflow: noop,

    // meta
    availableNodesMetaData: undefined,
    configsMap: undefined,

    // export / DSL
    exportCheck: vi.fn().mockResolvedValue(undefined),
    handleExportDSL: vi.fn().mockResolvedValue(undefined),
    getWorkflowRunAndTraceUrl: vi.fn().mockReturnValue({ runUrl: '', traceUrl: '' }),

    // inspect vars
    fetchInspectVars: vi.fn().mockResolvedValue(undefined),
    hasNodeInspectVars: vi.fn().mockReturnValue(false),
    hasSetInspectVar: vi.fn().mockReturnValue(false),
    fetchInspectVarValue: vi.fn().mockResolvedValue(undefined),
    editInspectVarValue: vi.fn().mockResolvedValue(undefined),
    renameInspectVarName: vi.fn().mockResolvedValue(undefined),
    appendNodeInspectVars: noop,
    deleteInspectVar: vi.fn().mockResolvedValue(undefined),
    deleteNodeInspectorVars: vi.fn().mockResolvedValue(undefined),
    deleteAllInspectorVars: vi.fn().mockResolvedValue(undefined),
    isInspectVarEdited: vi.fn().mockReturnValue(false),
    resetToLastRunVar: vi.fn().mockResolvedValue(undefined),
    invalidateSysVarValues: noop,
    resetConversationVar: vi.fn().mockResolvedValue(undefined),
    invalidateConversationVarValues: noop,

    ...overrides,
  }
}
