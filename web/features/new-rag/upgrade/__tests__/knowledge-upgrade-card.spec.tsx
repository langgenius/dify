import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { KnowledgeUpgrade } from '../knowledge-upgrade-context-value'
import { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/client'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { KnowledgeUpgradeCard } from '../knowledge-upgrade-card'
import { KnowledgeUpgradeProvider } from '../knowledge-upgrade-context'
import { KnowledgeUpgradeContext, useKnowledgeUpgrade } from '../knowledge-upgrade-context-value'

const requestMock = vi.hoisted(() => vi.fn(() => new Promise<Response>(() => {})))

vi.mock('@/service/base', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/service/base')>()
  return { ...original, request: requestMock }
})

vi.mock('@/app/components/datasets/list/dataset-card/components/dataset-card-header', () => ({
  default: ({ dataset }: { dataset: { name: string } }) => <div>{dataset.name}</div>,
}))

vi.mock('../knowledge-upgrade-dialog', () => ({
  KnowledgeUpgradeDialog: () => null,
}))

const job = {
  completed_documents: 12,
  completed_sources: 1,
  id: 'upgrade-1',
  new_control_space_id: 'space-1',
  old_dataset_id: 'dataset-1',
  snapshot_at: '2026-08-18T00:00:00Z',
  stage: 'submitting_documents',
  status: 'running',
  total_documents: 52,
  total_sources: 1,
} satisfies KnowledgeFsUpgradeJobResponse

const upgrade = {
  canRetry: false,
  dataset: {
    app_count: 2,
    description: 'Support articles',
    document_count: 52,
    id: 'dataset-1',
    name: 'Support knowledge',
    tags: [],
  },
  job,
} as unknown as KnowledgeUpgrade

const renderCard = (
  value: KnowledgeUpgrade,
  callbacks: {
    onSettled?: (upgrade: KnowledgeUpgrade) => void
    onSucceeded?: (controlSpaceId: string) => void
  } = {},
) =>
  renderWithConsoleQuery(
    <KnowledgeUpgradeContext
      value={{
        dismissUpgrade: vi.fn(),
        enabled: true,
        requestUpgrade: vi.fn(),
        settleUpgrade: vi.fn(),
        upgrades: [value],
      }}
    >
      <KnowledgeUpgradeCard upgrade={value} {...callbacks} />
    </KnowledgeUpgradeContext>,
  )

describe('KnowledgeUpgradeCard', () => {
  beforeEach(() => {
    requestMock.mockClear()
  })

  it('shows completed and total document counts while migration is active', () => {
    renderCard(upgrade)

    expect(screen.getByText('12/52')).toBeInTheDocument()
  })

  it.each(['failed', 'succeeded'] as const)(
    'shows only the total document count for a %s migration',
    (status) => {
      renderCard({
        ...upgrade,
        job: {
          ...job,
          stage: status === 'succeeded' ? 'completed' : 'submitting_documents',
          status,
        },
      })

      expect(screen.getByText('52')).toBeInTheDocument()
      expect(screen.queryByText('52/52')).not.toBeInTheDocument()
    },
  )

  it('shows the backend failure message and only offers retry when discovery allows it', () => {
    const failedUpgrade: KnowledgeUpgrade = {
      ...upgrade,
      canRetry: true,
      job: {
        ...job,
        last_error_message: 'The source could not be migrated',
        status: 'failed',
      },
    }

    renderCard(failedUpgrade)

    expect(screen.getByText('The source could not be migrated')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.retry' })).toBeInTheDocument()
  })

  it('does not request status for a terminal upgrade before retry', async () => {
    const failedUpgrade: KnowledgeUpgrade = {
      ...upgrade,
      canRetry: true,
      job: {
        ...job,
        status: 'failed',
      },
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    })

    renderWithConsoleQuery(<KnowledgeUpgradeCard upgrade={failedUpgrade} />, { queryClient })
    await act(async () => Promise.resolve())

    expect(requestMock).not.toHaveBeenCalled()
  })

  it('settles a locally tracked upgrade when polling reaches a terminal status', async () => {
    const onSettled = vi.fn()
    const onSucceeded = vi.fn()
    const { queryClient } = renderCard(upgrade, { onSettled, onSucceeded })
    const queryKey = consoleQuery.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get.queryOptions(
      {
        input: {
          params: {
            dataset_id: job.old_dataset_id,
            job_id: job.id,
          },
        },
      },
    ).queryKey

    await act(async () => {
      queryClient.setQueryData(queryKey, {
        ...job,
        completed_documents: job.total_documents,
        stage: 'completed',
        status: 'succeeded',
      })
    })

    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledWith(
        expect.objectContaining({
          canRetry: false,
          dataset: upgrade.dataset,
          job: expect.objectContaining({ id: job.id, status: 'succeeded' }),
        }),
      )
      expect(onSucceeded).toHaveBeenCalledWith(job.new_control_space_id)
    })
  })

  it('keeps a recovered upgrade in provider state after it settles', async () => {
    const user = userEvent.setup()

    function SettlementHarness() {
      const { settleUpgrade, upgrades } = useKnowledgeUpgrade()
      return (
        <>
          <button
            type="button"
            onClick={() =>
              settleUpgrade({
                ...upgrade,
                job: { ...job, stage: 'completed', status: 'succeeded' },
              })
            }
          >
            Settle recovered upgrade
          </button>
          <output>
            {upgrades.map((entry) => `${entry.job.id}:${entry.job.status}`).join(',')}
          </output>
        </>
      )
    }

    renderWithConsoleQuery(
      <KnowledgeUpgradeProvider onUpgradeStarted={vi.fn()}>
        <SettlementHarness />
      </KnowledgeUpgradeProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Settle recovered upgrade' }))

    expect(screen.getByText('upgrade-1:succeeded')).toBeInTheDocument()
  })
})
