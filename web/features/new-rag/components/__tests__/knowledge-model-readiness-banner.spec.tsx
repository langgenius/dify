import type { KnowledgeFsSettingsResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { KnowledgeModelReadinessBanner } from '../knowledge-model-readiness-banner'

const queryState = vi.hoisted(() => ({
  data: {
    active_profile_available: true,
    active_profile_revisions: { embedding: 1, retrieval: 1 },
    capabilities: {
      deep: true,
      index: true,
      ingest: true,
      query: true,
      research: true,
      source_sync: true,
    },
    configuration_state: 'active',
    embedding: null,
    issues: [] as Array<{
      code: 'binding_missing' | 'incompatible' | 'missing' | 'unavailable' | 'validation_failed'
      field: 'embedding' | 'publication' | 'reasoning' | 'rerank'
      retryable: boolean
    }>,
    retrieval: null,
    revision: 1,
  } as KnowledgeFsSettingsResponse,
  isError: false,
  isPending: false,
  refetch: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => queryState,
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/datasets/new/space-1/documents',
  useSearchParams: () => new URLSearchParams('status=failed'),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          settings: { get: { queryOptions: () => ({}) } },
        },
      },
    },
  },
}))

describe('KnowledgeModelReadinessBanner', () => {
  beforeEach(() => {
    queryState.data = {
      active_profile_available: true,
      active_profile_revisions: { embedding: 1, retrieval: 1 },
      capabilities: {
        deep: true,
        index: true,
        ingest: true,
        query: true,
        research: true,
        source_sync: true,
      },
      configuration_state: 'active',
      embedding: null,
      issues: [],
      retrieval: null,
      revision: 1,
    }
    queryState.isError = false
    queryState.isPending = false
    queryState.refetch.mockReset()
  })

  it('stays hidden when the active profile is healthy', () => {
    render(<KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId="space-1" />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stays hidden when model configuration is complete but the first profile is not active yet', () => {
    queryState.data = {
      ...queryState.data,
      active_profile_available: false,
      active_profile_revisions: { embedding: null, retrieval: null },
      capabilities: {
        deep: false,
        index: false,
        ingest: true,
        query: false,
        research: false,
        source_sync: true,
      },
    }

    render(<KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId="space-1" />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stays hidden when model configuration is complete despite an unrelated runtime issue', () => {
    queryState.data = {
      ...queryState.data,
      capabilities: { ...queryState.data.capabilities, research: false },
      issues: [{ code: 'unavailable', field: 'publication', retryable: true }],
    }

    render(<KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId="space-1" />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows configuration guidance when model setup is required', () => {
    queryState.data = {
      ...queryState.data,
      active_profile_available: false,
      active_profile_revisions: { embedding: null, retrieval: null },
      capabilities: {
        deep: false,
        index: false,
        ingest: false,
        query: false,
        research: false,
        source_sync: false,
      },
      configuration_state: 'setup-required',
      issues: [{ code: 'missing', field: 'embedding', retryable: false }],
    }

    render(<KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'knowledgeSpace.overview.attention.modelReadiness.profilesMissing',
    )
  })

  it('shows compact recovery guidance and preserves the current page', () => {
    queryState.data = {
      ...queryState.data,
      capabilities: { ...queryState.data.capabilities, index: false },
      configuration_state: 'validation-failed',
      issues: [{ code: 'validation_failed', field: 'embedding', retryable: true }],
    }

    render(<KnowledgeModelReadinessBanner capability="index" knowledgeSpaceId="space-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'knowledgeSpace.overview.attention.modelReadiness.description',
    )
    expect(
      screen.getByRole('link', {
        name: 'knowledgeSpace.overview.attention.action.configureModels',
      }),
    ).toHaveAttribute(
      'href',
      '/datasets/new/space-1/settings?returnTo=%2Fdatasets%2Fnew%2Fspace-1%2Fdocuments%3Fstatus%3Dfailed&capability=index',
    )
  })

  it('stays hidden while model validation is waiting for the first document', () => {
    queryState.data = {
      ...queryState.data,
      configuration_state: 'pending-validation',
      issues: [{ code: 'missing', field: 'embedding', retryable: true }],
    }

    render(<KnowledgeModelReadinessBanner knowledgeSpaceId="space-1" />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps a readiness fetch failure separate and retryable', async () => {
    const user = userEvent.setup()
    queryState.isError = true
    queryState.refetch.mockResolvedValue(undefined)

    render(<KnowledgeModelReadinessBanner knowledgeSpaceId="space-1" />)
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(queryState.refetch).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('link', {
        name: 'knowledgeSpace.overview.attention.action.configureModels',
      }),
    ).not.toBeInTheDocument()
  })
})
