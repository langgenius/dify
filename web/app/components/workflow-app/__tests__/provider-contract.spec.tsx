import type { ReactElement } from 'react'
import { screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import WorkflowApp from '../index'

const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, {
    appDetail: { id: 'app-1', name: 'Workflow App', mode: 'workflow', permission_keys: [] },
  })

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

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@/service/use-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/use-tools')>()
  return {
    ...actual,
    useAppTriggers: () => ({}),
  }
})

vi.mock('../hooks/use-get-run-and-trace-url', () => ({
  useGetRunAndTraceUrl: () => ({
    getWorkflowRunAndTraceUrl: () => ({ runUrl: '' }),
  }),
}))

vi.mock('../hooks/use-workflow-init', async () => {
  const React = await import('react')
  const { useStore, useWorkflowStore } = await import('@/app/components/workflow/store')

  return {
    useWorkflowInit: () => {
      useStore((state) => state.appId)
      const workflowStore = useWorkflowStore()

      React.useEffect(() => {
        workflowStore.setState({ notInitialWorkflow: true })
      }, [workflowStore])

      return {
        data: {
          graph: {
            nodes: [{ id: 'raw-node' }],
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

vi.mock('@/app/components/workflow/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/utils')>()
  return {
    ...actual,
    initialNodes: () => [
      {
        id: 'node-1',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { title: 'Start', type: 'start' },
      },
    ],
    initialEdges: () => [],
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
    const appId = useStore((state) => state.appId)
    const initialized = useStore((state) => state.notInitialWorkflow)
    const hasWorkflowSlice = useStore((state) => typeof state.setNotInitialWorkflow === 'function')
    const { store } = useWorkflowHistoryStore()

    return (
      <div>
        {`app:${appId} initialized:${initialized} history:${store.getState().nodes.length} slice:${String(hasWorkflowSlice)}`}
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
        <WorkflowApp appId="app-1" />
      </StrictMode>,
    )

    expect(
      await screen.findByText('app:app-1 initialized:true history:1 slice:true'),
    ).toBeInTheDocument()
  })
})
