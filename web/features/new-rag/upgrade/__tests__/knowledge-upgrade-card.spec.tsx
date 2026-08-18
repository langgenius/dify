import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { KnowledgeUpgrade } from '../knowledge-upgrade-context-value'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { KnowledgeUpgradeCard } from '../knowledge-upgrade-card'
import { KnowledgeUpgradeContext } from '../knowledge-upgrade-context-value'

vi.mock('@/app/components/datasets/list/dataset-card/components/dataset-card-header', () => ({
  default: ({ dataset }: { dataset: { name: string } }) => <div>{dataset.name}</div>,
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

const renderCard = (value: KnowledgeUpgrade) =>
  renderWithConsoleQuery(
    <KnowledgeUpgradeContext
      value={{
        enabled: true,
        requestUpgrade: vi.fn(),
        upgrades: [value],
      }}
    >
      <KnowledgeUpgradeCard upgrade={value} />
    </KnowledgeUpgradeContext>,
  )

describe('KnowledgeUpgradeCard', () => {
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
})
