import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { KnowledgeUpgradeDialog } from '../knowledge-upgrade-dialog'

const startUpgradeMock = vi.hoisted(() => vi.fn())
const discoverUpgradeMock = vi.hoisted(() => vi.fn())

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.knowledgeFsUpgrades.get': discoverUpgradeMock,
      'datasets.byDatasetId.knowledgeFsUpgrades.post': startUpgradeMock,
    }),
  }
})

const dataset = createDatasetFixture({ name: 'Support knowledge' })

const job = {
  completed_documents: 0,
  completed_sources: 0,
  id: 'upgrade-1',
  old_dataset_id: dataset.id,
  snapshot_at: '2026-08-18T00:00:00Z',
  stage: 'validating',
  status: 'queued',
  total_documents: 0,
  total_sources: 0,
} satisfies KnowledgeFsUpgradeJobResponse

describe('KnowledgeUpgradeDialog', () => {
  beforeEach(() => {
    discoverUpgradeMock.mockResolvedValue({
      can_retry: false,
      can_upgrade: true,
      job: null,
    })
  })

  it('offers upgrade details and documentation before requiring an explicit confirmation', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderWithConsoleQuery(
      <KnowledgeUpgradeDialog dataset={dataset} onCancel={onCancel} onStarted={vi.fn()} />,
    )

    expect(screen.getByText('knowledgeUpgrade.upgrade.dialogDuration')).toBeVisible()
    expect(screen.getByText('knowledgeUpgrade.upgrade.dialogLinkedApps')).toBeVisible()
    const learnMore = screen.getByRole('link', { name: 'knowledgeSpace.learnMore' })
    expect(learnMore.getAttribute('href')).toMatch(
      /\/use-dify\/knowledge-base\/upgrade-from-classic$/,
    )
    expect(learnMore).toHaveAttribute('target', '_blank')
    expect(screen.getByText(/knowledgeUpgrade\.upgrade\.summary/)).toBeVisible()
    expect(
      screen.getByRole('region', { name: 'knowledgeSpace.modelCost.title' }),
    ).toHaveTextContent('knowledgeUpgrade.upgrade.modelCostDescription')
    const startButton = screen.getByRole('button', { name: 'knowledgeUpgrade.upgrade.start' })
    expect(startButton).toHaveAccessibleDescription(
      expect.stringContaining('knowledgeUpgrade.upgrade.modelCostDescription'),
    )
    await waitFor(() => expect(startButton).toBeEnabled())
    expect(startUpgradeMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(startUpgradeMock).not.toHaveBeenCalled()
  })

  it('reuses the idempotency key when the same upgrade intent is retried', async () => {
    startUpgradeMock.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(job)
    const onStarted = vi.fn()
    const user = userEvent.setup()

    renderWithConsoleQuery(
      <KnowledgeUpgradeDialog dataset={dataset} onCancel={vi.fn()} onStarted={onStarted} />,
    )

    const startButton = await screen.findByRole('button', {
      name: 'knowledgeUpgrade.upgrade.start',
    })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'knowledgeUpgrade.upgrade.startFailed',
    )
    await user.click(startButton)

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(dataset, job))
    const firstInput = startUpgradeMock.mock.calls[0]?.[0]
    const secondInput = startUpgradeMock.mock.calls[1]?.[0]
    expect(firstInput).toEqual({
      headers: { 'Idempotency-Key': expect.any(String) },
      params: { dataset_id: 'dataset-1' },
    })
    expect(secondInput.headers['Idempotency-Key']).toBe(firstInput.headers['Idempotency-Key'])
    expect(discoverUpgradeMock).toHaveBeenCalledWith({ params: { dataset_id: 'dataset-1' } })
  })
})
