import type { AppUserAuthDraft } from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import { createAppUserAuthDraft } from '@/app/components/plugins/plugin-auth/app-user-auth/draft'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import { createWorkflowStore } from '../workflow'

const nodeId = 'tool-node'
const provider = 'test-provider'
const providerId = 'provider-1'
const toolNode = createNode({
  id: nodeId,
  data: { type: BlockEnum.Tool, provider_id: providerId },
})

const setupDraft = (draft: AppUserAuthDraft) => {
  const store = createWorkflowStore({})
  store.setState({ nodes: [toolNode] })
  store.getState().setNodeAppUserAuthDraft(nodeId, provider, providerId, draft)
  store.getState().setNodeAuthorizationTab(nodeId, provider, providerId, 'app-user-auth')
  return store
}

describe('Workflow App user Auth draft', () => {
  it('merges draft initialization and tab selection without writing graph data', () => {
    const draft = createAppUserAuthDraft({ canOAuth: false, canApiKey: true })
    const store = setupDraft(draft)

    expect(store.getState().nodeAuthDrafts[nodeId]).toEqual({
      provider,
      providerId,
      authorizationTab: 'app-user-auth',
      draft,
      errors: { methods: false, oauthClient: false, description: true },
    })
    expect(store.getState().nodes).toEqual([toolNode])
  })

  it('keeps independent live validation results for separate node drafts', () => {
    const store = setupDraft(createAppUserAuthDraft())
    const secondNode = createNode({
      id: 'second-tool',
      data: { type: BlockEnum.Tool, provider_id: 'second-provider' },
    })
    store
      .getState()
      .setNodeAppUserAuthDraft(
        secondNode.id,
        'second-provider',
        'second-provider',
        createAppUserAuthDraft({ canOAuth: false }),
      )
    store
      .getState()
      .setNodeAuthorizationTab(secondNode.id, 'second-provider', 'second-provider', 'app-user-auth')

    expect(store.getState().nodeAuthDrafts[nodeId]?.errors).toEqual({
      methods: false,
      oauthClient: true,
      description: true,
    })
    expect(store.getState().nodeAuthDrafts[secondNode.id]?.errors).toEqual({
      methods: false,
      oauthClient: false,
      description: true,
    })
  })

  it('immediately adds and clears errors as fields become invalid or valid', () => {
    const store = setupDraft({ oauthEnabled: false, apiKeyEnabled: false, description: '' })
    const setDraft = (draft: AppUserAuthDraft) =>
      store.getState().setNodeAppUserAuthDraft(nodeId, provider, providerId, draft)

    expect(store.getState().nodeAuthDrafts[nodeId]?.errors).toEqual({
      methods: true,
      oauthClient: false,
      description: true,
    })

    setDraft({ oauthEnabled: true, apiKeyEnabled: false, description: '' })
    expect(store.getState().nodeAuthDrafts[nodeId]?.errors).toEqual({
      methods: false,
      oauthClient: true,
      description: true,
    })

    setDraft({ oauthEnabled: true, apiKeyEnabled: false, description: 'Connect Drive' })
    expect(store.getState().nodeAuthDrafts[nodeId]?.errors).toEqual({
      methods: false,
      oauthClient: true,
      description: false,
    })

    setDraft({ oauthEnabled: true, apiKeyEnabled: false, description: '' })
    expect(store.getState().nodeAuthDrafts[nodeId]?.errors).toEqual({
      methods: false,
      oauthClient: true,
      description: true,
    })

    setDraft({
      oauthEnabled: true,
      apiKeyEnabled: false,
      description: '',
      client: { type: 'custom', clientId: 'local-client', clientSecret: 'local-secret' },
    })
    expect(store.getState().nodeAuthDrafts[nodeId]?.errors).toEqual({
      methods: false,
      oauthClient: false,
      description: true,
    })

    setDraft({ oauthEnabled: false, apiKeyEnabled: false, description: '' })
    expect(store.getState().nodeAuthDrafts[nodeId]?.errors).toEqual({
      methods: true,
      oauthClient: false,
      description: true,
    })
  })

  it.each(['workspace-auth', 'reuse-from-node'] as const)(
    'hides errors in %s and revalidates the preserved draft on returning',
    (tab) => {
      const draft = createAppUserAuthDraft()
      const store = setupDraft(draft)

      store.getState().setNodeAuthorizationTab(nodeId, provider, providerId, tab)

      expect(store.getState().nodeAuthDrafts[nodeId]?.draft).toEqual(draft)
      expect(store.getState().nodeAuthDrafts[nodeId]?.errors).toBeUndefined()

      store.getState().setNodeAuthorizationTab(nodeId, provider, providerId, 'app-user-auth')
      expect(store.getState().nodeAuthDrafts[nodeId]?.draft).toEqual(draft)
      expect(store.getState().nodeAuthDrafts[nodeId]?.errors).toEqual({
        methods: false,
        oauthClient: true,
        description: true,
      })
    },
  )
})

describe('Workflow Reuse from node selection', () => {
  const source = { id: 'upstream-tool', title: 'List files' }

  it('stores the selected source snapshot without writing graph data', () => {
    const store = createWorkflowStore({})
    const upstreamNode = createNode({
      id: source.id,
      data: { type: BlockEnum.Tool, title: source.title, provider_id: providerId },
    })
    store.setState({ nodes: [upstreamNode, toolNode] })
    store.getState().setNodeAuthorizationTab(nodeId, provider, providerId, 'reuse-from-node')

    store.getState().setNodeReuseFromNode(nodeId, provider, providerId, source)

    expect(store.getState().nodeAuthDrafts[nodeId]).toEqual({
      provider,
      providerId,
      authorizationTab: 'reuse-from-node',
      reuseFromNode: { source },
    })
    expect(store.getState().nodes).toEqual([upstreamNode, toolNode])
  })

  it.each(['workspace-auth', 'app-user-auth'] as const)(
    'preserves the source and App user draft when switching through %s',
    (tab) => {
      const draft = createAppUserAuthDraft()
      const store = setupDraft(draft)
      store.getState().setNodeAuthorizationTab(nodeId, provider, providerId, 'reuse-from-node')
      store.getState().setNodeReuseFromNode(nodeId, provider, providerId, source)

      store.getState().setNodeAuthorizationTab(nodeId, provider, providerId, tab)

      expect(store.getState().nodeAuthDrafts[nodeId]?.reuseFromNode).toEqual({ source })
      expect(store.getState().nodeAuthDrafts[nodeId]?.draft).toEqual(draft)

      store.getState().setNodeAuthorizationTab(nodeId, provider, providerId, 'reuse-from-node')

      expect(store.getState().nodeAuthDrafts[nodeId]?.reuseFromNode).toEqual({ source })
      expect(store.getState().nodeAuthDrafts[nodeId]?.draft).toEqual(draft)
      expect(store.getState().nodeAuthDrafts[nodeId]?.errors).toBeUndefined()
    },
  )

  it('keeps selections independent for different target nodes', () => {
    const store = createWorkflowStore({})
    const secondSource = { id: 'another-upstream-tool', title: 'Find documents' }
    store.getState().setNodeReuseFromNode(nodeId, provider, providerId, source)

    store.getState().setNodeReuseFromNode('second-tool', provider, providerId, secondSource)

    expect(store.getState().nodeAuthDrafts[nodeId]?.reuseFromNode).toEqual({ source })
    expect(store.getState().nodeAuthDrafts['second-tool']?.reuseFromNode).toEqual({
      source: secondSource,
    })
  })

  it('clears a retained circular source atomically when activating Reuse and preserves other drafts', () => {
    const draft = createAppUserAuthDraft()
    const store = setupDraft(draft)
    store.getState().setNodeReuseFromNode(nodeId, provider, providerId, source)
    store.getState().setNodeReuseFromNode(source.id, provider, providerId, {
      id: nodeId,
      title: toolNode.data.title,
    })
    store.getState().setNodeAuthorizationTab(source.id, provider, providerId, 'reuse-from-node')
    const otherDraft = store.getState().nodeAuthDrafts[source.id]
    expect(store.getState().nodeAuthDrafts[nodeId]?.errors?.description).toBe(true)

    const observedStates: ReturnType<typeof store.getState>['nodeAuthDrafts'][] = []
    const unsubscribe = store.subscribe((state) => observedStates.push(state.nodeAuthDrafts))

    store.getState().setNodeAuthorizationTab(nodeId, provider, providerId, 'reuse-from-node', {
      clearReuseFromNode: true,
    })
    unsubscribe()

    expect(observedStates).toHaveLength(1)
    expect(observedStates[0]?.[nodeId]).toMatchObject({
      authorizationTab: 'reuse-from-node',
      draft,
    })
    expect(observedStates[0]?.[nodeId]?.reuseFromNode).toBeUndefined()
    expect(observedStates[0]?.[nodeId]?.errors).toBeUndefined()
    expect(observedStates[0]?.[source.id]).toEqual(otherDraft)
  })

  it('replaces the selected source while retaining the App user draft', () => {
    const draft = createAppUserAuthDraft()
    const store = setupDraft(draft)
    const replacement = { id: 'replacement-tool', title: 'Search documents' }
    store.getState().setNodeReuseFromNode(nodeId, provider, providerId, source)

    store.getState().setNodeReuseFromNode(nodeId, provider, providerId, replacement)

    expect(store.getState().nodeAuthDrafts[nodeId]?.reuseFromNode).toEqual({
      source: replacement,
    })
    expect(store.getState().nodeAuthDrafts[nodeId]?.draft).toEqual(draft)
    expect(store.getState().nodeAuthDrafts[nodeId]?.authorizationTab).toBe('app-user-auth')
  })

  it.each([
    { nextProvider: 'another-provider', nextProviderId: providerId },
    { nextProvider: provider, nextProviderId: 'another-provider-id' },
  ])(
    'starts a fresh entry when the provider identity changes to $nextProvider / $nextProviderId',
    ({ nextProvider, nextProviderId }) => {
      const store = setupDraft(createAppUserAuthDraft())
      const replacement = { id: 'replacement-tool', title: 'List documents' }
      store.getState().setNodeReuseFromNode(nodeId, provider, providerId, source)

      store.getState().setNodeReuseFromNode(nodeId, nextProvider, nextProviderId, replacement)

      expect(store.getState().nodeAuthDrafts[nodeId]).toMatchObject({
        provider: nextProvider,
        providerId: nextProviderId,
        reuseFromNode: { source: replacement },
      })
      expect(store.getState().nodeAuthDrafts[nodeId]?.draft).toBeUndefined()
      expect(store.getState().nodeAuthDrafts[nodeId]?.errors).toBeUndefined()
    },
  )
})
