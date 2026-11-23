import type { DefaultModelResponse } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { zDefaultModelDataResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { createStore as createAtomStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useEffect, useState } from 'react'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { createWorkflowAppStore as createWorkflowStore } from '@/app/components/workflow-app/__tests__/workflow-store'
import WorkflowMain from '@/app/components/workflow-app/components/workflow-main'
import { useWorkflowRefreshDraft } from '@/app/components/workflow-app/draft/use-draft-refresh'
import { createRunningWorkflowState } from '@/app/components/workflow-app/hooks/use-workflow-run-utils'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import WorkflowWithDefaultContext, {
  WorkflowWithInnerContext,
} from '@/app/components/workflow/index'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import DifyBuilderComposer from '@/features/dify-builder/composer'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { appId, nodes, viewport } from './canvas-navigation-data'

// Canvas tree for canvas-navigation.browser.spec.tsx. That spec declares the module
// boundaries this tree runs behind; import this file only after those mocks.

type SaveDraft = () => Promise<null>

export type RefreshDraft = ReturnType<typeof useWorkflowRefreshDraft>['handleRefreshWorkflowDraft']

function CanvasWithRefresh({
  saveDraft,
  onReady,
  collaborationRecovery = false,
}: {
  saveDraft: SaveDraft
  onReady?: (refresh: RefreshDraft) => void
  collaborationRecovery?: boolean
}) {
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  useEffect(() => {
    onReady?.(handleRefreshWorkflowDraft)
  }, [handleRefreshWorkflowDraft, onReady])
  if (collaborationRecovery) return <WorkflowMain nodes={nodes} edges={[]} viewport={viewport} />

  return (
    <WorkflowWithInnerContext
      nodes={nodes}
      edges={[]}
      viewport={viewport}
      hooksStore={{ doSyncWorkflowDraft: saveDraft, handleRefreshWorkflowDraft }}
    />
  )
}

export function Fixture({
  saveDraft,
  ordinaryRun = false,
  onRefreshReady,
  collaborationRecovery = false,
  workflowStore,
}: {
  saveDraft: SaveDraft
  ordinaryRun?: boolean
  onRefreshReady?: (refresh: RefreshDraft) => void
  collaborationRecovery?: boolean
  workflowStore?: ReturnType<typeof createWorkflowStore>
}) {
  const [store] = useState(() => {
    const workflow = workflowStore ?? createWorkflowStore()
    workflow.setState({
      isWorkflowDataLoaded: true,
      canvasReadOnly: !ordinaryRun,
      builderCanvasReadOnly: !ordinaryRun,
      workflowDraftSyncPhase: ordinaryRun ? 'idle' : 'builder',
      workflowRunningData: ordinaryRun ? createRunningWorkflowState() : undefined,
    })
    return workflow
  })
  const [queryClient] = useState(() => {
    const query = createConsoleQueryWrapper({
      appDslVersion: '0.6.0',
    }).queryClient
    query.setQueryData(
      consoleQuery.apps.byAppId.get.queryKey({
        input: { params: { app_id: appId } },
      }),
      createAppDetailFixture({ id: appId, mode: 'workflow' }),
    )
    for (const toolsQuery of [
      consoleQuery.workspaces.current.tools.builtin.get,
      consoleQuery.workspaces.current.tools.api.get,
      consoleQuery.workspaces.current.tools.workflow.get,
      consoleQuery.workspaces.current.tools.mcp.get,
    ])
      query.setQueryData(toolsQuery.queryKey(), [])
    query.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type: ModelTypeEnum.textGeneration } },
      }),
      zDefaultModelDataResponse.parse({
        data: {
          model: 'gpt-4o',
          model_type: ModelTypeEnum.textGeneration,
          provider: {
            provider: 'openai',
            icon_small: { en_US: '', zh_Hans: '' },
            label: { en_US: 'OpenAI' },
            supported_model_types: [ModelTypeEnum.textGeneration],
            tenant_id: 'workspace-1',
          },
        } satisfies DefaultModelResponse,
      }),
    )
    return query
  })
  const [atomStore] = useState(() => {
    const atoms = createAtomStore()
    atoms.set(queryClientAtom, queryClient)
    return atoms
  })
  return (
    <QueryClientProvider client={queryClient}>
      <Provider store={atomStore}>
        <EditorResourceScope
          resource={{
            kind: 'app',
            appId,
            mode: 'workflow',
            collaborationEnabled: collaborationRecovery,
          }}
        >
          <FeaturesProvider>
            <EventEmitterContextProvider>
              <WorkflowContext value={store}>
                <WorkflowWithDefaultContext nodes={nodes} edges={[]}>
                  <div style={{ display: 'flex', width: 1000, height: 600 }}>
                    <div style={{ width: ordinaryRun ? 700 : 1000, height: 600 }}>
                      <CanvasWithRefresh
                        saveDraft={saveDraft}
                        onReady={onRefreshReady}
                        collaborationRecovery={collaborationRecovery}
                      />
                    </div>
                    {ordinaryRun && (
                      <div style={{ width: 300 }}>
                        <DifyBuilderComposer />
                      </div>
                    )}
                  </div>
                </WorkflowWithDefaultContext>
              </WorkflowContext>
            </EventEmitterContextProvider>
          </FeaturesProvider>
        </EditorResourceScope>
      </Provider>
    </QueryClientProvider>
  )
}
