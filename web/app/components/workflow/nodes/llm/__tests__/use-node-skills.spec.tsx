import type { ReactNode } from 'react'
import type { App, AppSSO } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useNodeSkills } from '../use-node-skills'

type MockNode = {
  id: string
  data: Record<string, unknown>
}

const mocks = vi.hoisted(() => ({
  nodeSkills: vi.fn(),
  nodeSkillsQueryKey: vi.fn((_input: unknown) => ['console', 'workflowDraft', 'nodeSkills']),
  store: {
    getState: vi.fn(),
  },
  nodes: [] as MockNode[],
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    workflowDraft: {
      nodeSkills: (input: unknown) => mocks.nodeSkills(input),
    },
  },
  consoleQuery: {
    workflowDraft: {
      nodeSkills: {
        queryKey: (input: unknown) => mocks.nodeSkillsQueryKey(input),
      },
    },
  },
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => mocks.store,
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('useNodeSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nodes = [
      {
        id: 'node-1',
        data: {
          type: 'llm',
          prompt_template: [{ text: 'first prompt', skill: true }],
        },
      },
    ]
    mocks.store.getState.mockImplementation(() => ({
      getNodes: () => mocks.nodes,
    }))
    mocks.nodeSkills.mockResolvedValue({
      tool_dependencies: [],
    })
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
  })

  it('should avoid refetching when the request key stays the same', async () => {
    const { rerender } = renderHook(
      ({ promptTemplateKey }) => useNodeSkills({
        nodeId: 'node-1',
        promptTemplateKey,
      }),
      {
        initialProps: { promptTemplateKey: 'prompt-key-1' },
        wrapper: createWrapper(),
      },
    )

    await waitFor(() => {
      expect(mocks.nodeSkills).toHaveBeenCalledTimes(1)
    })

    mocks.nodes = [
      {
        id: 'node-1',
        data: {
          type: 'llm',
          prompt_template: [{ text: 'updated prompt', skill: true }],
        },
      },
    ]

    rerender({ promptTemplateKey: 'prompt-key-1' })

    await waitFor(() => {
      expect(mocks.nodeSkills).toHaveBeenCalledTimes(1)
    })
  })

  it('should refetch with the latest node data when the request key changes', async () => {
    const { rerender } = renderHook(
      ({ promptTemplateKey }) => useNodeSkills({
        nodeId: 'node-1',
        promptTemplateKey,
      }),
      {
        initialProps: { promptTemplateKey: 'prompt-key-1' },
        wrapper: createWrapper(),
      },
    )

    await waitFor(() => {
      expect(mocks.nodeSkills).toHaveBeenCalledTimes(1)
    })

    mocks.nodes = [
      {
        id: 'node-1',
        data: {
          type: 'llm',
          prompt_template: [{ text: 'updated prompt', skill: true }],
        },
      },
    ]

    rerender({ promptTemplateKey: 'prompt-key-2' })

    await waitFor(() => {
      expect(mocks.nodeSkills).toHaveBeenCalledTimes(2)
    })

    expect(mocks.nodeSkills).toHaveBeenLastCalledWith({
      params: { appId: 'app-1' },
      body: {
        type: 'llm',
        prompt_template: [{ text: 'updated prompt', skill: true }],
      },
    })
  })
})
