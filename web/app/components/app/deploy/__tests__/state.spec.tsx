import type {
  WorkflowPaginationResponse,
  WorkflowResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
import { screen, render as testingLibraryRender } from '@testing-library/react'
import { Provider, useAtomValue } from 'jotai'
import { createQueryAtomTestStore } from '@/test/query-atom'
import {
  AppDeployStateBoundary,
  appWorkflowVersionsAtom,
  latestAppWorkflowVersionAtom,
} from '../state'

type QueryOptions = {
  input: unknown
}

type InfiniteQueryOptions = {
  getNextPageParam: (lastPage: WorkflowPaginationResponse) => number | undefined
  initialPageParam: number
  input: (pageParam: number) => unknown
}

const queryOptionsMocks = vi.hoisted(() => ({
  latest: vi.fn(),
  versions: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        workflows: {
          get: {
            infiniteOptions: (options: InfiniteQueryOptions) => {
              queryOptionsMocks.versions(options)

              return {
                ...options,
                queryFn: async () => ({
                  has_more: false,
                  items: [],
                  limit: 10,
                  page: 1,
                }),
                queryKey: ['appWorkflowVersions'],
                staleTime: Infinity,
              }
            },
          },
          publish: {
            get: {
              queryOptions: (options: QueryOptions) => {
                queryOptionsMocks.latest(options)

                return {
                  ...options,
                  queryFn: async () => undefined,
                  queryKey: ['latestPublishedWorkflow'],
                  staleTime: Infinity,
                }
              },
            },
          },
        },
      },
    },
  },
}))

function workflowVersion({
  id,
  name,
  publishedBy,
  version = `2026-07-30.${id}`,
  versionNumber,
}: {
  id: string
  name: string
  publishedBy: string
  version?: string
  versionNumber?: number
}): WorkflowResponse {
  return {
    conversation_variables: [],
    created_at: 1_710_000_100,
    created_by: {
      email: `${publishedBy.toLowerCase()}@example.com`,
      id: `user-${publishedBy.toLowerCase()}`,
      name: publishedBy,
    },
    environment_variables: [],
    features: {},
    graph: {},
    hash: `hash-${id}`,
    id,
    marked_comment: `${name} notes`,
    marked_name: name,
    rag_pipeline_variables: [],
    tool_published: false,
    updated_at: 1_710_000_100,
    version,
    version_number: versionNumber,
  }
}

function StateConsumer() {
  const latestVersion = useAtomValue(latestAppWorkflowVersionAtom)
  const versions = useAtomValue(appWorkflowVersionsAtom)

  return (
    <>
      <div>{`Latest: ${latestVersion?.name}`}</div>
      {versions.map((version) => (
        <div key={version.id}>
          {`${version.name} · ${version.publishedBy} · ${version.latest ? 'latest' : 'previous'}`}
        </div>
      ))}
    </>
  )
}

function render(ui: ReactElement) {
  const { queryClient, store } = createQueryAtomTestStore()
  const latestVersion = workflowVersion({
    id: 'version-3',
    name: 'Release 3',
    publishedBy: 'Alice',
  })
  const previousVersion = workflowVersion({
    id: 'version-2',
    name: '',
    publishedBy: 'Bob',
    versionNumber: 2,
  })
  const draftVersion = workflowVersion({
    id: 'draft-version',
    name: 'Draft',
    publishedBy: 'Alice',
    version: 'draft',
  })

  queryClient.setQueryData(['latestPublishedWorkflow'], latestVersion)
  queryClient.setQueryData(['appWorkflowVersions'], {
    pageParams: [1, 2],
    pages: [
      {
        has_more: true,
        items: [draftVersion, latestVersion],
        limit: 2,
        page: 1,
      },
      {
        has_more: false,
        items: [previousVersion],
        limit: 1,
        page: 2,
      },
    ],
  })

  return testingLibraryRender(<Provider store={store}>{ui}</Provider>)
}

describe('app deploy workflow version state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps published workflow pages without drafts in state and uses a non-paginated latest query', () => {
    render(
      <AppDeployStateBoundary appId="app-1">
        <StateConsumer />
      </AppDeployStateBoundary>,
    )

    expect(screen.getByText('Latest: Release 3')).toBeInTheDocument()
    expect(screen.getByText('Release 3 · Alice · latest')).toBeInTheDocument()
    expect(screen.getByText('# 2 · Bob · previous')).toBeInTheDocument()
    expect(screen.queryByText(/Draft/)).not.toBeInTheDocument()

    expect(queryOptionsMocks.latest).toHaveBeenCalledWith({
      input: {
        params: {
          app_id: 'app-1',
        },
      },
    })

    const infiniteOptions = queryOptionsMocks.versions.mock.lastCall?.[0] as InfiniteQueryOptions
    expect(infiniteOptions.initialPageParam).toBe(1)
    expect(infiniteOptions.input(3)).toEqual({
      params: {
        app_id: 'app-1',
      },
      query: {
        limit: 10,
        page: 3,
      },
    })
    expect(
      infiniteOptions.getNextPageParam({
        has_more: true,
        items: [],
        limit: 10,
        page: 3,
      }),
    ).toBe(4)
    expect(
      infiniteOptions.getNextPageParam({
        has_more: false,
        items: [],
        limit: 10,
        page: 3,
      }),
    ).toBeUndefined()
  })
})
