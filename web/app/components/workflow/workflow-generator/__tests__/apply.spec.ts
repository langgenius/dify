import type { GeneratedGraph } from '../types'
import { AppModeEnum } from '@/types/app'
import {
  applyToCurrentApp,
  applyToNewApp,
  WorkflowApplyHashCollisionError,
  WorkflowApplyOrphanError,
} from '../apply'

// Stub the service calls so each test can assert what was POSTed without
// touching real fetch / next router state.
const mockCreateApp = vi.fn()
const mockSyncWorkflowDraft = vi.fn()
const mockFetchWorkflowDraft = vi.fn()
const mockDeleteApp = vi.fn()

vi.mock('@/service/apps', () => ({
  createApp: (params: unknown) => mockCreateApp(params),
  deleteApp: (appId: string) => mockDeleteApp(appId),
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (url: string) => mockFetchWorkflowDraft(url),
  syncWorkflowDraft: (params: unknown) => mockSyncWorkflowDraft(params),
}))

const makeGraph = (): GeneratedGraph => ({
  nodes: [
    {
      id: 'node-1',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { type: 'start', title: 'Start' },
    } as never,
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 0.7 },
})

describe('applyToNewApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateApp.mockResolvedValue({ id: 'new-app-1', mode: AppModeEnum.WORKFLOW })
    mockSyncWorkflowDraft.mockResolvedValue({})
  })

  // The new-app path must create the app, then sync the generated graph to
  // its draft and return the routing context the caller uses to navigate.
  it('should create the app, sync the draft and return the new app id and mode', async () => {
    const graph = makeGraph()
    const result = await applyToNewApp({ mode: 'workflow', graph, instruction: 'Summarize a URL' })

    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: AppModeEnum.WORKFLOW,
        icon_type: 'emoji',
      }),
    )
    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith({
      url: 'apps/new-app-1/workflows/draft',
      params: {
        graph,
        features: {},
        environment_variables: [],
        conversation_variables: [],
      },
    })
    expect(result).toEqual({ appId: 'new-app-1', appMode: AppModeEnum.WORKFLOW })
  })

  // Mode → AppModeEnum must round-trip for chatflow; the type-level guarantee
  // is verified at runtime so a regression here is caught before users hit it.
  it('should map advanced-chat mode to AppModeEnum.ADVANCED_CHAT', async () => {
    mockCreateApp.mockResolvedValueOnce({ id: 'cf-1', mode: AppModeEnum.ADVANCED_CHAT })

    const result = await applyToNewApp({
      mode: 'advanced-chat',
      graph: makeGraph(),
      instruction: 'A chat bot that answers questions',
    })

    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.objectContaining({ mode: AppModeEnum.ADVANCED_CHAT }),
    )
    expect(result.appMode).toBe(AppModeEnum.ADVANCED_CHAT)
  })

  // The derived name keeps the user instruction recognisable in the apps list
  // — strip trailing punctuation and never produce an empty string.
  it('should derive a sensible app name from the instruction', async () => {
    await applyToNewApp({
      mode: 'workflow',
      graph: makeGraph(),
      instruction: '   Build a translator.   ',
    })

    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Build a translator' }),
    )
  })

  // Instruction-only-of-punctuation must still produce a usable, non-empty
  // app name so create-app doesn't fail validation.
  it('should fall back to "Generated Workflow" when the instruction is empty', async () => {
    await applyToNewApp({ mode: 'workflow', graph: makeGraph(), instruction: '   ' })

    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Generated Workflow' }),
    )
  })

  // When the planner picks a name + emoji, those win over the
  // instruction-derived fallback so users see a real product name in the
  // apps list (e.g. "URL Summarizer" + 📰 instead of "Summarize a URL" + 🤖).
  it('should prefer planner-supplied app_name and icon over the fallbacks', async () => {
    await applyToNewApp({
      mode: 'workflow',
      graph: makeGraph(),
      instruction: 'Summarize a URL',
      appName: 'URL Summarizer',
      icon: '📰',
    })

    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'URL Summarizer',
        icon: '📰',
      }),
    )
  })

  // When the planner returns whitespace-only values (older prompts / model
  // drift), the fallbacks must kick in so we never POST an empty string to
  // createApp.
  it('should fall back when planner-supplied app_name / icon are blank', async () => {
    await applyToNewApp({
      mode: 'workflow',
      graph: makeGraph(),
      instruction: 'Summarize a URL',
      appName: '   ',
      icon: '',
    })

    expect(mockCreateApp).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Summarize a URL',
        icon: '🤖',
      }),
    )
  })

  // Sync failure must roll back the createApp so the user isn't left with an
  // empty app in their /apps list. deleteApp is called with the new app id,
  // and the original sync error is re-thrown so the caller can toast it.
  it('should delete the new app when syncWorkflowDraft fails', async () => {
    mockCreateApp.mockResolvedValueOnce({ id: 'doomed', mode: AppModeEnum.WORKFLOW })
    const syncErr = new Error('sync exploded')
    mockSyncWorkflowDraft.mockRejectedValueOnce(syncErr)
    mockDeleteApp.mockResolvedValueOnce(undefined)

    await expect(
      applyToNewApp({
        mode: 'workflow',
        graph: makeGraph(),
        instruction: 'x',
      }),
    ).rejects.toBe(syncErr)

    expect(mockDeleteApp).toHaveBeenCalledWith('doomed')
  })

  // The truly stuck path: sync fails AND the rollback delete also fails. We
  // throw WorkflowApplyOrphanError so the caller can route to /apps where
  // the orphan is at least discoverable for manual cleanup. The error
  // carries the orphan app id so the toast can name it.
  it('should throw WorkflowApplyOrphanError when both sync and rollback fail', async () => {
    mockCreateApp.mockResolvedValueOnce({ id: 'orphan-7', mode: AppModeEnum.WORKFLOW })
    mockSyncWorkflowDraft.mockRejectedValueOnce(new Error('sync exploded'))
    mockDeleteApp.mockRejectedValueOnce(new Error('delete also exploded'))

    let caught: unknown
    try {
      await applyToNewApp({ mode: 'workflow', graph: makeGraph(), instruction: 'x' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(WorkflowApplyOrphanError)
    expect((caught as WorkflowApplyOrphanError).orphanAppId).toBe('orphan-7')
  })
})

describe('applyToCurrentApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncWorkflowDraft.mockResolvedValue({})
  })

  // Happy path: the fetch yields an existing draft so the sync MUST include
  // its hash. Without this, the backend rejects the write with
  // WorkflowHashNotEqualError (the original bug behind the manual fix).
  it('should fetch the current draft and forward its hash on sync', async () => {
    mockFetchWorkflowDraft.mockResolvedValue({
      hash: 'h-existing',
      features: { file_upload: { enabled: true } },
      environment_variables: [{ id: 'e1', name: 'API_KEY', value_type: 'secret', value: 'x' }],
      conversation_variables: [{ id: 'c1', name: 'memory', value_type: 'string', value: '' }],
    })

    const graph = makeGraph()
    await applyToCurrentApp({ appId: 'app-42', graph })

    expect(mockFetchWorkflowDraft).toHaveBeenCalledWith('apps/app-42/workflows/draft')
    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith({
      url: 'apps/app-42/workflows/draft',
      params: expect.objectContaining({
        graph,
        features: { file_upload: { enabled: true } },
        hash: 'h-existing',
      }),
    })
    // Existing env vars and conversation vars must be preserved verbatim.
    const params = mockSyncWorkflowDraft.mock.calls[0]![0].params
    expect(params.environment_variables).toHaveLength(1)
    expect(params.conversation_variables).toHaveLength(1)
  })

  // First-apply path: a freshly created Workflow app has no draft yet, so the
  // fetch resolves to undefined and we must sync without a hash field so the
  // backend lazy-creates the draft instead of raising.
  it('should sync without a hash when no draft yet exists', async () => {
    mockFetchWorkflowDraft.mockResolvedValue(undefined)

    await applyToCurrentApp({ appId: 'fresh-app', graph: makeGraph() })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    const params = mockSyncWorkflowDraft.mock.calls[0]![0].params
    expect(params).not.toHaveProperty('hash')
    expect(params.features).toEqual({})
    expect(params.environment_variables).toEqual([])
    expect(params.conversation_variables).toEqual([])
  })

  // Resilience: a fetch failure (network blip, transient 5xx) must not block
  // the apply — fall back to a hashless sync so the new draft can still land.
  it('should fall back to a hashless sync when fetchWorkflowDraft throws', async () => {
    mockFetchWorkflowDraft.mockRejectedValue(new Error('network down'))

    await applyToCurrentApp({ appId: 'app-7', graph: makeGraph() })

    expect(mockSyncWorkflowDraft).toHaveBeenCalledTimes(1)
    const params = mockSyncWorkflowDraft.mock.calls[0]![0].params
    expect(params).not.toHaveProperty('hash')
  })

  // A 409 from syncWorkflowDraft is the backend's signal that another tab
  // edited the draft between our fetch and sync. The apply layer translates
  // that Response into a typed error so the caller can show a Reload
  // affordance instead of a generic "apply failed" toast.
  it('should translate a 409 sync rejection into WorkflowApplyHashCollisionError', async () => {
    mockFetchWorkflowDraft.mockResolvedValue({
      hash: 'h1',
      features: {},
      environment_variables: [],
      conversation_variables: [],
    })
    // ``base.ts`` rejects with the raw Response on non-401 — fake just the
    // ``status`` field, which is what ``isHashCollisionResponse`` consults.
    mockSyncWorkflowDraft.mockRejectedValueOnce({ status: 409, code: 'draft_workflow_not_sync' })

    await expect(applyToCurrentApp({ appId: 'app-9', graph: makeGraph() })).rejects.toBeInstanceOf(
      WorkflowApplyHashCollisionError,
    )
  })

  // Non-409 errors (5xx, network) MUST NOT be misclassified as hash
  // collisions — those still surface as the original rejection so the
  // generic "apply failed" toast fires.
  it('should NOT translate non-409 sync rejections', async () => {
    mockFetchWorkflowDraft.mockResolvedValue({
      hash: 'h1',
      features: {},
      environment_variables: [],
      conversation_variables: [],
    })
    const original = { status: 500, code: 'internal_server_error' }
    mockSyncWorkflowDraft.mockRejectedValueOnce(original)

    await expect(applyToCurrentApp({ appId: 'app-9', graph: makeGraph() })).rejects.toBe(original)
  })

  it('should NOT translate string or null sync rejections', async () => {
    mockFetchWorkflowDraft.mockResolvedValue({
      hash: 'h1',
      features: {},
      environment_variables: [],
      conversation_variables: [],
    })

    // String error
    const strError = 'some string error'
    mockSyncWorkflowDraft.mockRejectedValueOnce(strError)
    await expect(applyToCurrentApp({ appId: 'app-9', graph: makeGraph() })).rejects.toBe(strError)

    // Null error
    mockSyncWorkflowDraft.mockRejectedValueOnce(null)
    await expect(applyToCurrentApp({ appId: 'app-9', graph: makeGraph() })).rejects.toBeNull()
  })
})
