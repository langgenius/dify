import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { KnowledgeFsApiAccessDialog } from '../knowledge-fs-api-access-dialog'

const serviceMock = vi.hoisted(() => ({
  create: vi.fn(),
  listQueryOptions: vi.fn(() => ({ queryKey: ['knowledge-fs', 'credentials'] })),
  refetch: vi.fn(),
  revoke: vi.fn(),
}))

const credentialsQueryMock = vi.hoisted(() => ({
  data: {
    data: [
      {
        allowed_actions: ['queries.create'],
        credential_last4: '1234',
        credential_prefix: 'kfs_',
        expires_at: null,
        id: 'credential-1',
        last_used_at: null,
        principal: 'credential-1',
        revision: 1,
        status: 'active',
      },
    ],
  },
  isError: false,
  isPending: false,
  refetch: serviceMock.refetch,
}))

const useQueryOptionsMock = vi.hoisted(() => vi.fn())

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetApiBaseUrl: () => ({ data: { api_base_url: 'https://api.example.com/v1/' } }),
}))

vi.mock('@/app/components/base/copy-feedback', () => ({
  CopyFeedback: ({ content }: { content: string }) => (
    <button type="button" aria-label={`copy:${content}`} />
  ),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown> }) => ({
      isPending: false,
      mutateAsync: options.mutationFn,
    }),
    useQuery: (options: unknown) => {
      useQueryOptionsMock(options)
      return credentialsQueryMock
    },
  }
})

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          credentials: {
            byCredentialId: {
              delete: serviceMock.revoke,
            },
            post: serviceMock.create,
          },
        },
      },
    },
  },
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          credentials: {
            get: {
              queryOptions: serviceMock.listQueryOptions,
            },
          },
        },
      },
    },
  },
}))

describe('KnowledgeFsApiAccessDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    credentialsQueryMock.isError = false
    credentialsQueryMock.isPending = false
    serviceMock.create.mockResolvedValue({
      allowed_actions: ['queries.create'],
      credential: 'kfs_secret-once',
      credential_last4: 'once',
      credential_prefix: 'kfs_',
      expires_at: null,
      id: 'credential-2',
      principal: 'credential-2',
    })
    serviceMock.refetch.mockResolvedValue(undefined)
    serviceMock.revoke.mockResolvedValue(undefined)
  })

  it('uses the real credentials API and reveals the new secret once', async () => {
    const user = userEvent.setup()
    render(
      <KnowledgeFsApiAccessDialog
        canManageCredentials
        status="active"
        knowledgeSpaceId="space-1"
        open
        onOpenChange={vi.fn()}
      />,
    )

    expect(
      screen.getByText('https://api.example.com/v1/knowledge-fs/spaces/space-1/queries/admission'),
    ).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.apiCredentialDescription')).toBeInTheDocument()
    expect(serviceMock.listQueryOptions).toHaveBeenCalledWith({
      input: { params: { control_space_id: 'space-1' } },
      context: { silent: true },
    })
    expect(useQueryOptionsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))

    await user.click(screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }))

    await waitFor(() => expect(serviceMock.create).toHaveBeenCalledOnce())
    expect(serviceMock.create).toHaveBeenCalledWith(
      {
        body: { allowed_actions: ['queries.create'], expires_at: null },
        params: { control_space_id: 'space-1' },
      },
      { context: { silent: true } },
    )
    expect(screen.getByText('kfs_secret-once')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'copy:kfs_secret-once' })).toBeInTheDocument()
    expect(serviceMock.refetch).toHaveBeenCalledOnce()
  })

  it('revokes an existing credential through its generated endpoint', async () => {
    const user = userEvent.setup()
    render(
      <KnowledgeFsApiAccessDialog
        canManageCredentials
        status="active"
        knowledgeSpaceId="space-1"
        open
        onOpenChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.delete kfs_••••1234' }))
    await user.click(screen.getByRole('button', { name: /^common\.operation\.delete$/ }))

    await waitFor(() => expect(serviceMock.revoke).toHaveBeenCalledOnce())
    expect(serviceMock.revoke).toHaveBeenCalledWith(
      {
        params: { control_space_id: 'space-1', credential_id: 'credential-1' },
      },
      { context: { silent: true } },
    )
    expect(serviceMock.refetch).toHaveBeenCalledOnce()
  })

  it('does not expose credential creation while API access is disabled', () => {
    render(
      <KnowledgeFsApiAccessDialog
        canManageCredentials
        status="inactive"
        knowledgeSpaceId="space-1"
        open
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByText('dataset.newKnowledge.apiAccessInactive')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }),
    ).not.toBeInTheDocument()
    expect(useQueryOptionsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })

  it('renders one local error when credential creation fails silently', async () => {
    const user = userEvent.setup()
    serviceMock.create.mockRejectedValueOnce(new Error('upstream route detail'))
    render(
      <KnowledgeFsApiAccessDialog
        canManageCredentials
        status="active"
        knowledgeSpaceId="space-1"
        open
        onOpenChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }))

    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent('common.api.actionFailed')
    expect(serviceMock.create).toHaveBeenCalledWith(expect.any(Object), {
      context: { silent: true },
    })
    expect(screen.queryByText('upstream route detail')).not.toBeInTheDocument()
  })

  it('keeps one local error visible in the revoke confirmation when revocation fails silently', async () => {
    const user = userEvent.setup()
    serviceMock.revoke.mockRejectedValueOnce(new Error('upstream revoke route detail'))
    render(
      <KnowledgeFsApiAccessDialog
        canManageCredentials
        status="active"
        knowledgeSpaceId="space-1"
        open
        onOpenChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.delete kfs_••••1234' }))
    const confirmation = screen.getByRole('alertdialog')
    await user.click(
      within(confirmation).getByRole('button', { name: /^common\.operation\.delete$/ }),
    )

    const alert = await within(confirmation).findByRole('alert')
    expect(alert).toHaveTextContent('common.api.actionFailed')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(serviceMock.revoke).toHaveBeenCalledWith(expect.any(Object), {
      context: { silent: true },
    })
    expect(serviceMock.refetch).not.toHaveBeenCalled()
    expect(screen.queryByText('upstream revoke route detail')).not.toBeInTheDocument()
  })
})
