import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
import { screen, render as testingLibraryRender } from '@testing-library/react'
import { Provider, useAtomValue } from 'jotai'
import {
  appWorkflowQueryOptions,
  appWorkflowVersionsInfiniteQueryOptions,
} from '@/service/workflow-queries'
import { createQueryAtomTestStore } from '@/test/query-atom'
import {
  AppDeployStateBoundary,
  appWorkflowVersionsAtom,
  latestAppWorkflowVersionAtom,
} from '../state'

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

  queryClient.setQueryData(appWorkflowQueryOptions('app-1').queryKey, latestVersion)
  queryClient.setQueryData(appWorkflowVersionsInfiniteQueryOptions('app-1').queryKey, {
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

  it('uses cached published pages, excludes drafts, and identifies the latest version', () => {
    render(
      <AppDeployStateBoundary appId="app-1">
        <StateConsumer />
      </AppDeployStateBoundary>,
    )

    expect(screen.getByText('Latest: Release 3')).toBeInTheDocument()
    expect(screen.getByText('Release 3 · Alice · latest')).toBeInTheDocument()
    expect(screen.getByText('# 2 · Bob · previous')).toBeInTheDocument()
    expect(screen.queryByText(/Draft/)).not.toBeInTheDocument()
  })
})
