import type { ReactNode } from 'react'
import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useEdges, useNodes } from 'reactflow'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { useNodesSyncDraft } from '@/app/components/workflow-app/hooks/use-nodes-sync-draft'
import { createWorkflowSlice } from '@/app/components/workflow-app/store/workflow/workflow-slice'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../../__tests__/workflow-test-env'
import { BlockEnum } from '../../../types'
import webhookDefault from '../../trigger-webhook/default'
import Panel from '../panel'

const persistDraft = vi.fn()
const fetchWebhook = vi.fn()
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: {
      ...actual.consoleClient,
      apps: {
        byAppId: { workflows: { draft: { post: (...args: unknown[]) => persistDraft(...args) } } },
      },
    },
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.triggers.webhook.get': (input: unknown) => fetchWebhook(input),
    }),
  }
})

const selectedStart = {
  metaData: webhookDefault.metaData,
  checkValid: () => ({ isValid: true }),
  defaultValue: { ...webhookDefault.defaultValue, title: 'Webhook', desc: '' },
}

const nodesMap: Partial<NonNullable<AvailableNodesMetaData['nodesMap']>> = {
  [BlockEnum.TriggerWebhook]: selectedStart,
}

function DraftOwner({ children }: { children: ReactNode }) {
  const sync = useNodesSyncDraft()
  const [hooks] = useState(() =>
    createHooksStore({
      ...sync,
      availableNodesMetaData: {
        nodes: [selectedStart],
        nodesMap: nodesMap as AvailableNodesMetaData['nodesMap'],
      },
    }),
  )
  return <HooksStoreContext value={hooks}>{children}</HooksStoreContext>
}

function GraphState() {
  const nodes = useNodes(),
    edges = useEdges()
  return (
    <>
      <output aria-label="Graph">{JSON.stringify(nodes)}</output>
      <output aria-label="Edges">{JSON.stringify(edges.map((edge) => edge.id))}</output>
    </>
  )
}

afterEach(() => vi.restoreAllMocks())

it.each([false, true])(
  'preserves the other nodes and waits for a saved graph before requesting webhook URLs (collaboration %s)',
  async (enabled) => {
    const user = userEvent.setup()
    const pending = createDeferred<{ hash: string; updated_at: number }>()
    persistDraft.mockClear().mockReturnValue(pending.promise)
    fetchWebhook.mockClear()
    const sync = vi.spyOn(collaborationManager, 'syncLoroDraft').mockImplementation(async () => {
      const { hash, updated_at } = await pending.promise
      return { hash, updatedAt: updated_at }
    })
    let notifyReady: ((ready: boolean) => void) | undefined
    vi.spyOn(collaborationManager, 'canPersistLocalGraph').mockReturnValue(false)
    vi.spyOn(collaborationManager, 'onGraphReadyChange').mockImplementation((listener) => {
      notifyReady = listener
      return () => {
        notifyReady = undefined
      }
    })
    const setNodes = vi.spyOn(collaborationManager, 'setNodes').mockImplementation(() => {})
    fetchWebhook.mockResolvedValue({
      webhook_url: 'https://hooks.example.com/live',
      webhook_debug_url: 'https://hooks.example.com/debug',
    })
    const placeholder = createNode({
      id: 'placeholder-1',
      data: { type: BlockEnum.StartPlaceholder, selected: true },
    })
    const { queryClient } = createConsoleQueryWrapper({
      appDslVersion: '0.6.0',
      systemFeatures: { enable_marketplace: false },
    })
    queryClient.setQueryData(
      consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }),
      [],
    )
    const { store } = renderWorkflowFlowComponent(
      <FeaturesContext value={createFeaturesStore()}>
        <DraftOwner>
          <Panel
            panelProps={{
              getInputVars: () => [],
              toVarInputs: () => [],
              runInputData: {},
              runInputDataRef: { current: {} },
              setRunInputData: () => {},
              runResult: null,
            }}
            id={placeholder.id}
            data={placeholder.data}
          />
          <GraphState />
        </DraftOwner>
      </FeaturesContext>,
      {
        queryClient,
        injectWorkflowStoreSliceFn: createWorkflowSlice as InjectWorkflowStoreSliceFn,
        initialStoreState: { isWorkflowDataLoaded: true },
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: enabled },
        nodes: [
          placeholder,
          createNode({ id: 'other-node', data: { selected: true } }),
          createNode({ id: 'peer-node' }),
        ],
        edges: [createEdge({ id: 'peer-edge', source: 'other-node', target: 'peer-node' })],
      },
    )
    await user.click(await screen.findByRole('button', { name: 'workflow.blocks.trigger-webhook' }))
    if (enabled) {
      expect(setNodes).not.toHaveBeenCalled()
      expect(sync).not.toHaveBeenCalled()
      expect(notifyReady).toBeDefined()
      act(() => notifyReady!(true))
      expect(setNodes).toHaveBeenCalledOnce()
      expect(sync).toHaveBeenCalledWith('app-1')
      expect(persistDraft).not.toHaveBeenCalled()
    }
    expect(screen.getByLabelText('Edges')).toHaveTextContent('peer-edge')
    const nodes = JSON.parse(screen.getByLabelText('Graph').textContent!)
    expect(nodes[0]).toMatchObject({
      id: 'placeholder-1',
      data: { type: BlockEnum.TriggerWebhook, title: 'Webhook', selected: true, webhook_url: '' },
    })
    expect(nodes[1].data.selected).toBe(false)
    expect(store.getState().hasSelectedStartNode).toBe(true)
    expect(store.getState().shouldAutoOpenStartNodeSelector).toBe(true)
    if (!enabled)
      expect(persistDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { app_id: 'app-1' },
          body: expect.objectContaining({
            graph: expect.objectContaining({
              nodes: expect.arrayContaining([
                expect.objectContaining({
                  id: 'placeholder-1',
                  data: expect.objectContaining({ type: BlockEnum.TriggerWebhook }),
                }),
              ]),
            }),
          }),
        }),
        expect.anything(),
      )
    expect(fetchWebhook).not.toHaveBeenCalled()
    await act(async () => pending.resolve({ hash: 'saved-hash', updated_at: 123 }))
    await waitFor(() =>
      expect(JSON.parse(screen.getByLabelText('Graph').textContent!)[0].data).toMatchObject({
        webhook_url: 'https://hooks.example.com/live',
        webhook_debug_url: 'https://hooks.example.com/debug',
      }),
    )
    expect(fetchWebhook).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      query: { node_id: 'placeholder-1' },
    })
    if (!enabled) {
      expect(store.getState().syncWorkflowDraftHash).toBe('saved-hash')
      expect(store.getState().draftUpdatedAt).toBe(123000)
    }
  },
)
