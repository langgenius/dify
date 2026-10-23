import type { ComponentProps } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { KnowledgeFsApiAccessDialog } from '../api-access-dialog'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.apiBaseInfo.get': async () => ({ api_base_url: 'https://api.example.com/v1/' }),
    }),
  }
})

// The key manager owns its own list and mutations; this suite only proves the hand-off.
vi.mock('@/app/components/api-key/dataset-api-key-dialog-content', async () => {
  const { DialogContent, DialogTitle } = await import('@langgenius/dify-ui/dialog')
  return {
    DatasetApiKeyDialogContent: (props: { canManage: boolean }) => (
      <DialogContent>
        <DialogTitle>workspace-dataset-api-keys:{String(props.canManage)}</DialogTitle>
      </DialogContent>
    ),
  }
})

function renderDialog(
  props: ComponentProps<typeof KnowledgeFsApiAccessDialog>,
  workspacePermissionKeys: string[] = ['dataset.api_key.manage'],
) {
  return renderWithConsoleQuery(<KnowledgeFsApiAccessDialog {...props} />, {
    workspacePermissionKeys,
  })
}

describe('KnowledgeFsApiAccessDialog', () => {
  it('shows the generated KnowledgeFS Service API endpoint', async () => {
    renderDialog({
      status: 'active',
      knowledgeSpaceId: 'space-1',
      open: true,
      onOpenChange: vi.fn(),
    })

    expect(
      await screen.findByText('https://api.example.com/v1/knowledge-fs/spaces/space-1'),
    ).toBeInTheDocument()
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
    expect(
      await screen.findByRole('dialog', { name: 'workspace-dataset-api-keys:true' }),
    ).toBeInTheDocument()
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
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /workspace-dataset-api-keys/ }),
      ).not.toBeInTheDocument(),
    )
  })

  it('uses the workspace API key permission for the read-only state', () => {
    renderDialog(
      {
        status: 'active',
        knowledgeSpaceId: 'space-1',
        open: true,
        onOpenChange: vi.fn(),
      },
      [],
    )

    expect(screen.getByText('knowledgeSpace.settings.viewOnly')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'dataset.serviceApi.card.apiKey' }),
    ).not.toBeInTheDocument()
  })
})
