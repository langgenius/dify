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
