import type { ComponentProps } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { KnowledgeFsApiAccessDialog } from '../api-access-dialog'

const workspacePermissionKeysMock = vi.hoisted(() => ({
  value: ['dataset.api_key.manage'],
}))

const apiBaseInfoQueryOptionsMock = vi.hoisted(() =>
  vi.fn(() => ({
    queryFn: () => Promise.resolve({ api_base_url: 'https://api.example.com/v1/' }),
    queryKey: ['datasets', 'api-base-info'],
  })),
)

const apiKeyModalPropsMock = vi.hoisted(() => vi.fn())

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: () => workspacePermissionKeysMock.value,
  }
})

vi.mock('@/app/components/api-key/api-key-modal', () => ({
  ApiKeyModal: (props: {
    canManage: boolean
    onOpenChange: (open: boolean) => void
    open: boolean
    scope: { type: string }
  }) => {
    apiKeyModalPropsMock(props)
    return props.open ? (
      <div role="dialog" aria-label="workspace-dataset-api-keys">
        {props.scope.type}:{String(props.canManage)}
      </div>
    ) : null
  },
}))

vi.mock('@/app/components/base/copy-feedback', () => ({
  CopyFeedback: ({ content }: { content: string }) => (
    <button type="button" aria-label={`copy:${content}`} />
  ),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    datasets: {
      apiBaseInfo: {
        get: {
          queryOptions: apiBaseInfoQueryOptionsMock,
        },
      },
    },
  },
}))

function renderDialog(props: ComponentProps<typeof KnowledgeFsApiAccessDialog>) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <KnowledgeFsApiAccessDialog {...props} />
    </QueryClientProvider>,
  )
}

describe('KnowledgeFsApiAccessDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspacePermissionKeysMock.value = ['dataset.api_key.manage']
  })

  it('shows the generated KnowledgeFS Service API endpoint', async () => {
    renderDialog({
      status: 'active',
      knowledgeSpaceId: 'space-1',
      open: true,
      onOpenChange: vi.fn(),
    })

    expect(
      await screen.findByText(
        'https://api.example.com/v1/knowledge-fs/spaces/space-1/queries/admission',
      ),
    ).toBeInTheDocument()
    expect(apiBaseInfoQueryOptionsMock).toHaveBeenCalledWith({ context: { silent: true } })
    expect(screen.getByText('common.appMenus.apiAccessTip')).toBeInTheDocument()
  })

  it('opens the shared workspace Dataset API key manager', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    renderDialog({
      status: 'active',
      knowledgeSpaceId: 'space-1',
      open: true,
      onOpenChange,
    })

    await user.click(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(apiKeyModalPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ canManage: true, open: true, scope: { type: 'dataset' } }),
    )
  })

  it('does not expose API key management while Service API access is disabled', async () => {
    renderDialog({
      status: 'inactive',
      knowledgeSpaceId: 'space-1',
      open: true,
      onOpenChange: vi.fn(),
    })

    expect(screen.getByText('knowledgeSpace.apiAccessInactive')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.serviceApi.card.apiKey' }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(apiKeyModalPropsMock).toHaveBeenCalled())
    expect(apiKeyModalPropsMock).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }))
  })

  it('uses the workspace API key permission for the read-only state', () => {
    workspacePermissionKeysMock.value = []
    renderDialog({
      status: 'active',
      knowledgeSpaceId: 'space-1',
      open: true,
      onOpenChange: vi.fn(),
    })

    expect(screen.getByText('knowledgeSpace.settings.viewOnly')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.serviceApi.card.apiKey' }),
    ).not.toBeInTheDocument()
  })
})
