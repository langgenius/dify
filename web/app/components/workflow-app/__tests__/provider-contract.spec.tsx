import type { ReactElement } from 'react'
import { screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { seedAppDetail } from '@/test/console/query-data'
import { render as renderWithConsoleState } from '@/test/console/render'
import { createAppDetailFixture } from '@/test/fixtures/app'
import WorkflowApp from '../index'

const render = (ui: ReactElement) => {
  const queryClient = createAccountProfileQueryClient()
  seedAppDetail(
    queryClient,
    createAppDetailFixture({
      id: 'app-1',
      name: 'Workflow App',
      mode: 'workflow' as const,
      permission_keys: [],
    }),
  )
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.triggers.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    { data: [] },
  )
  return renderWithConsoleState(ui, {
    wrapper: createQueryClientWrapper(queryClient),
  })
}

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
    isLoadingCurrentWorkspace: false,
  }))
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('../hooks/use-workflow-init', async () => {
  const React = await import('react')
  const { useStore, useWorkflowStore } = await import('@/app/components/workflow/store')

  return {
    useWorkflowInit: () => {
      useStore((state) => state.syncWorkflowDraftHash)
      const workflowStore = useWorkflowStore()

      React.useEffect(() => {
        workflowStore.setState({ syncWorkflowDraftHash: 'initialized-draft' })
      }, [workflowStore])

      return {
        data: {
          graph: {
            nodes: [createNode({ id: 'raw-node', data: { type: BlockEnum.Start } })],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
          features: {},
        },
        isLoading: false,
        fileUploadConfigResponse: null,
      }
    },
  }
})

vi.mock('@/app/components/workflow/persistence/local-storage-bridge', () => ({
  WorkflowLocalStorageBridge: () => null,
}))

vi.mock('../components/workflow-main', async () => {
  const { useStore } = await import('@/app/components/workflow/store')
  const { useWorkflowHistoryStore } =
    await import('@/app/components/workflow/workflow-history-store')

  const WorkflowMainProbe = () => {
    const appId = useStore((state) => state.syncWorkflowDraftHash)
    const hasWorkflowSlice = useStore((state) => typeof state.setNotInitialWorkflow === 'function')
    const { store } = useWorkflowHistoryStore()

    return (
      <div>
        {`app:${appId} history:${store.getState().nodes.length} slice:${String(hasWorkflowSlice)}`}
      </div>
    )
  }

  return {
    default: WorkflowMainProbe,
  }
})

describe('WorkflowApp provider contract', () => {
  it('shares one workflow store between initialization and the initialized canvas', async () => {
    render(
      <StrictMode>
        <WorkflowApp />
      </StrictMode>,
    )

    expect(
      await screen.findByText('app:initialized-draft history:1 slice:true'),
    ).toBeInTheDocument()
  })
})
