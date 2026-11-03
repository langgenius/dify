import type { ComponentProps } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { KnowledgeFsApiAccessDialog } from '../api-access-dialog'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.apiKeys.get': async () => ({
        data: [
          {
            id: 'workspace-key',
            token: 'dataset-existing-secret',
            created_at: 1710000000,
            last_used_at: null,
            type: 'dataset',
            dataset_ids: [],
            knowledge_space_ids: [],
          },
        ],
      }),
      'datasets.apiBaseInfo.get': async () => ({ api_base_url: 'https://api.example.com/v1/' }),
    }),
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
    function Viewer() {
      const [open, setOpen] = useState(true)
      return (
        <KnowledgeFsApiAccessDialog
          status="active"
          knowledgeSpaceId="space-1"
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next)
            setOpen(next)
          }}
        />
      )
    }
    renderWithConsoleQuery(<Viewer />, { workspacePermissionKeys: ['dataset.api_key.manage'] })

    await user.click(screen.getByRole('button', { name: 'dataset.serviceApi.card.apiKey' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(
      await screen.findByRole('dialog', { name: 'appApi.apiKeyModal.apiSecretKey' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('datas...cret')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByLabelText('knowledgeSpace.apiAgentAccess')).not.toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: 'appApi.apiKeyModal.createNewSecretKey' }),
    ).toBeEnabled()
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
        screen.queryByRole('dialog', { name: 'appApi.apiKeyModal.apiSecretKey' }),
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
