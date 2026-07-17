import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactsImPlatformProvider } from '../composition'
import { createContactImMockRepository } from '../mock/repository'
import { ContactImMockScenario } from '../mock/scenarios'
import { ContactImSyncDetailsDialog } from '../sync-details-dialog'

const organization = {
  canManage: true,
  organizationId: 'org-details',
  workspaceId: 'workspace-details',
}

const runIds = {
  [ContactImMockScenario.DetailFailure]: 'mock-sync-detail-failure',
  [ContactImMockScenario.PageFailure]: 'mock-sync-page-failure',
  [ContactImMockScenario.PaginatedResults]: 'mock-sync-paginated',
  [ContactImMockScenario.SyncFailure]: 'mock-sync-failure',
  [ContactImMockScenario.SyncPartialSuccess]: 'mock-sync-partial',
  [ContactImMockScenario.SyncSuccess]: 'mock-sync-success',
} as const

const renderDetails = (scenario: keyof typeof runIds) => {
  const repository = createContactImMockRepository({ organization, scenario })
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ContactsImPlatformProvider organization={organization} repository={repository}>
        {children}
      </ContactsImPlatformProvider>
    </QueryClientProvider>
  )

  return {
    queryClient,
    repository,
    ...render(
      <ContactImSyncDetailsDialog open runId={runIds[scenario]} onOpenChange={() => undefined} />,
      { wrapper },
    ),
  }
}

describe('Contact IM sync details dialog', () => {
  it('matches the 840px details shell and exposes the complete result taxonomy', async () => {
    renderDetails(ContactImMockScenario.SyncPartialSuccess)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveClass('w-[840px]')
    for (const result of [
      'matched',
      'created_binding',
      'updated_binding',
      'unmatched',
      'skipped',
      'failed',
    ]) {
      expect(
        await screen.findByRole('button', {
          name: `contacts.imPlatform.details.filter.${result} 1`,
        }),
      ).toBeInTheDocument()
    }
  })

  it('filters unmatched rows, uses placeholders for missing fields, and remains read-only', async () => {
    const user = userEvent.setup()
    renderDetails(ContactImMockScenario.SyncPartialSuccess)
    await user.click(
      await screen.findByRole('button', {
        name: 'contacts.imPlatform.details.filter.unmatched 1',
      }),
    )

    expect(await screen.findByText('Member unmatched-1')).toBeInTheDocument()
    expect(screen.getAllByText('contacts.imPlatform.details.missing').length).toBeGreaterThan(0)
    expect(
      screen.getByText('contacts.imPlatform.details.safeReason.no_matching_contact'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /map contact|create external contact/i }),
    ).not.toBeInTheDocument()
  })

  it('keeps filter query pages isolated when changing result categories', async () => {
    const user = userEvent.setup()
    renderDetails(ContactImMockScenario.SyncPartialSuccess)
    await user.click(
      await screen.findByRole('button', {
        name: 'contacts.imPlatform.details.filter.unmatched 1',
      }),
    )
    expect(await screen.findByText('Member unmatched-1')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.details.filter.failed 1' }),
    )
    expect(await screen.findByText('Member failed-1')).toBeInTheDocument()
    expect(screen.queryByText('Member unmatched-1')).not.toBeInTheDocument()
  })

  it('loads subsequent pages without duplicating existing rows', async () => {
    const user = userEvent.setup()
    renderDetails(ContactImMockScenario.PaginatedResults)
    expect(await screen.findByText('Member matched-1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.loadMore' }))

    expect(await screen.findByText('Member updated-1')).toBeInTheDocument()
    expect(screen.getAllByText('Member matched-1')).toHaveLength(1)
  })

  it('retains loaded rows and offers a page-specific retry after pagination fails', async () => {
    const user = userEvent.setup()
    renderDetails(ContactImMockScenario.PageFailure)
    expect(await screen.findByText('Member matched-1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.loadMore' }))

    expect(await screen.findByText('contacts.imPlatform.details.pageError')).toBeInTheDocument()
    expect(screen.getByText('Member matched-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'contacts.imPlatform.action.retry' })).toBeEnabled()
  })

  it('shows a recoverable initial detail error', async () => {
    const user = userEvent.setup()
    const { repository } = renderDetails(ContactImMockScenario.DetailFailure)
    const getSyncRun = vi.spyOn(repository, 'getSyncRun')
    expect(await screen.findByText('contacts.imPlatform.details.loadError')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.retry' }))
    await waitFor(() => expect(getSyncRun).toHaveBeenCalled())
  })

  it('renders only the typed safe run error for a failed sync', async () => {
    const { container } = renderDetails(ContactImMockScenario.SyncFailure)

    expect(
      await screen.findByText('contacts.imPlatform.details.safeReason.provider_request_failed'),
    ).toBeInTheDocument()
    expect(container.innerHTML).not.toContain('provider-token')
    expect(container.innerHTML).not.toContain('request-header')
  })
})
