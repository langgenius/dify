import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { DatasetListResponse } from './new-knowledge-list-test-env'
import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { apiError, installFakeApi } from '@/test/fake-api'
import {
  datasetsPage,
  legacyDataset,
  members,
  recoveryKeys,
  setup,
  space,
  spacesPage,
  upgradeCards,
  job as upgradeJob,
} from './new-knowledge-list-test-env'

// Dataset ids are UUIDs in the contract.
const datasetId = '00000000-0000-4000-8000-000000000001'
const job = (overrides: Parameters<typeof upgradeJob>[0] = {}) =>
  upgradeJob({ old_dataset_id: datasetId, ...overrides })

// The upgrade card reads job detail on this production polling interval.
const UPGRADE_POLL_INTERVAL = 2_000

function fakeUpgradePolling() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
}

const api = {
  spaces: vi.fn<typeof consoleClient.knowledgeFs.spaces.get>(),
  deleteSpace: vi.fn<typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.delete>(),
  members: vi.fn<typeof consoleClient.workspaces.current.members.get>(),
  upgradeJobs: vi.fn<typeof consoleClient.datasets.knowledgeFsUpgradeJobs.get>(),
  upgradeJob: vi.fn<typeof consoleClient.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get>(),
  datasets: vi.fn<typeof consoleClient.datasets.get>(),
}

describe('NewKnowledgeList upgrade recovery', () => {
  beforeEach(async () => {
    await page.viewport(1000, 760)
    onTestFinished(
      installFakeApi({
        console: {
          knowledgeFs: {
            spaces: {
              get: (input) => api.spaces(input),
              byControlSpaceId: {
                delete: async (input) => {
                  await api.deleteSpace(input)
                },
              },
            },
          },
          workspaces: { current: { members: { get: (input) => api.members(input) } } },
          datasets: {
            get: (input) => api.datasets(input),
            knowledgeFsUpgradeJobs: { get: (input) => api.upgradeJobs(input) },
            byDatasetId: {
              knowledgeFsUpgrades: { byJobId: { get: (input) => api.upgradeJob(input) } },
            },
            apiBaseInfo: { get: () => ({ api_base_url: 'https://api.example.com' }) },
            externalKnowledgeApi: {
              get: () => ({ data: [], has_more: false, limit: 100, page: 1, total: 0 }),
            },
          },
          tags: {
            get: () => [
              { binding_count: '1', id: 'tag-1', name: 'Customer support', type: 'knowledge' },
              { binding_count: '1', id: 'tag-2', name: 'Public docs', type: 'knowledge' },
            ],
          },
        },
      }),
    )
    api.spaces.mockResolvedValue(spacesPage())
    api.deleteSpace.mockResolvedValue(undefined)
    api.members.mockResolvedValue({ accounts: members })
    api.upgradeJobs.mockResolvedValue({ data: [] })
    api.upgradeJob.mockImplementation(() => new Promise(() => {}))
    api.datasets.mockResolvedValue(datasetsPage([]))
  })

  describe('upgrade recovery', () => {
    it('restores upgrade cards from exact legacy dataset lookups', async () => {
      const failed = job({ status: 'failed' })
      api.upgradeJobs.mockResolvedValue({ data: [failed] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(failed, { can_retry: true })]))
      await setup()

      const card = upgradeCards('Support knowledge')
      await expect.element(card).toBeVisible()
      await expect
        .element(card.getByRole('button', { name: 'common.operation.retry' }))
        .toBeInTheDocument()
      expect(api.datasets).toHaveBeenCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ ids: [datasetId] }) }),
      )
    })

    it('batches legacy dataset lookups and bounds failed-job recovery', async () => {
      const jobs = [
        ...Array.from({ length: 51 }, (_, index) =>
          job({ id: `running-${index}`, old_dataset_id: `dataset-${index}` }),
        ),
        ...Array.from({ length: 101 }, (_, index) =>
          job({
            id: `failed-${index}`,
            old_dataset_id: `failed-dataset-${index}`,
            status: 'failed',
          }),
        ),
      ]
      api.upgradeJobs.mockResolvedValue({ data: jobs })
      await setup()

      await vi.waitFor(() => expect(api.datasets).toHaveBeenCalledTimes(4))
      const batches = api.datasets.mock.calls.map(([input]) => input?.query?.ids ?? [])
      expect(batches.every((ids) => ids.length <= 50)).toBe(true)
      expect(batches.flat()).toEqual(jobs.slice(0, 151).map((item) => item.old_dataset_id))
    })

    it('keeps the empty workspace loading while upgrade datasets are restored', async () => {
      api.upgradeJobs.mockResolvedValue({ data: [job()] })
      const datasets = createDeferred<DatasetListResponse>()
      api.datasets.mockReturnValue(datasets.promise)
      await setup()

      await vi.waitFor(() => expect(api.datasets).toHaveBeenCalled())
      await expect.element(page.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
      await expect.element(page.getByText('knowledgeSpace.emptyTitle')).not.toBeInTheDocument()
    })

    it('retries a failed upgrade recovery', async () => {
      const user = userEvent
      const running = job()
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.datasets
        .mockRejectedValueOnce(apiError('SERVICE_UNAVAILABLE', 503, 'request failed'))
        .mockResolvedValue(datasetsPage([legacyDataset(running)]))
      await setup()

      await expect
        .element(page.getByRole('heading', { name: 'knowledgeSpace.errorTitle' }))
        .toBeInTheDocument()
      await user.click(page.getByRole('button', { name: 'common.operation.retry' }))

      await expect.poll(() => upgradeCards('Support knowledge').elements().length).toBe(1)
    })

    it('keeps historical failures for one dataset distinct by job', async () => {
      const older = job({ id: 'upgrade-1', status: 'failed' })
      const newer = job({ id: 'upgrade-2', status: 'failed' })
      api.upgradeJobs.mockResolvedValue({ data: [older, newer] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(newer, { can_retry: true })]))
      await setup()

      await expect.poll(() => upgradeCards('Support knowledge').elements().length).toBe(2)
      expect(api.datasets).toHaveBeenCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ ids: [datasetId] }) }),
      )
    })

    it('offers retry for an older failure after a newer migration succeeds', async () => {
      const failed = job({ id: 'upgrade-failed', status: 'failed' })
      api.upgradeJobs.mockResolvedValue({ data: [failed] })
      api.datasets.mockResolvedValue(
        datasetsPage([
          legacyDataset(
            job({
              id: 'upgrade-succeeded',
              new_control_space_id: 'space-1',
              stage: 'completed',
              status: 'succeeded',
            }),
            { can_upgrade: true },
          ),
        ]),
      )
      await setup()

      await expect
        .element(page.getByRole('button', { name: 'common.operation.retry' }))
        .toBeInTheDocument()
    })

    it('keeps server retry eligibility authoritative over a stale local upgrade', async () => {
      const running = job()
      const failed = job({ status: 'failed', last_error_message: 'The import failed' })
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(running)]))
      const detail = createDeferred<KnowledgeFsUpgradeJobResponse>()
      api.upgradeJob.mockReturnValue(detail.promise)
      fakeUpgradePolling()
      const { refresh } = await setup()
      await expect.element(upgradeCards('Support knowledge')).toBeVisible()
      api.upgradeJobs.mockResolvedValue({ data: [failed] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(failed)]))
      detail.resolve(failed)
      await vi.advanceTimersByTimeAsync(UPGRADE_POLL_INTERVAL)
      await expect.element(page.getByText('The import failed')).toBeVisible()
      await refresh(...recoveryKeys())
      await expect.poll(() => upgradeCards('Support knowledge').elements().length).toBe(1)
      await expect
        .element(page.getByRole('button', { name: 'common.operation.retry' }))
        .not.toBeInTheDocument()
    })

    it('hides a knowledge space behind its active upgrade card', async () => {
      const running = job({ new_control_space_id: 'space-1' })
      api.spaces.mockResolvedValue(spacesPage([space('space-1', 'space-1')]))
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(running)]))
      await setup()

      await expect.poll(() => upgradeCards('Support knowledge').elements().length).toBe(1)
      await expect.element(page.getByRole('link', { name: 'space-1' })).not.toBeInTheDocument()
    })

    it('dismisses a completed local upgrade only after its space is visible and the job leaves recovery', async () => {
      const running = job()
      const succeeded = job({
        completed_documents: 10,
        new_control_space_id: 'space-1',
        stage: 'completed',
        status: 'succeeded',
      })
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.datasets.mockResolvedValue(datasetsPage([legacyDataset(running)]))
      api.upgradeJob.mockResolvedValue(succeeded)
      fakeUpgradePolling()
      const { refresh } = await setup()
      await expect.element(upgradeCards('Support knowledge')).toBeVisible()
      await vi.advanceTimersByTimeAsync(UPGRADE_POLL_INTERVAL)
      await expect
        .element(page.getByRole('link', { name: 'Support knowledge' }))
        .toHaveAttribute('href', '/datasets/new/space-1')

      api.upgradeJobs.mockResolvedValue({ data: [] })
      api.spaces.mockResolvedValue(spacesPage([space('space-2', 'Engineering handbook')]))
      await refresh(...recoveryKeys())
      // Wait for the new response to reach the DOM before checking retention of the old card.
      await expect.element(page.getByRole('link', { name: 'Engineering handbook' })).toBeVisible()
      await expect.element(page.getByRole('link', { name: 'Support knowledge' })).toBeVisible()
      api.upgradeJobs.mockResolvedValue({ data: [running] })
      api.spaces.mockResolvedValue(spacesPage([space('space-1', 'Upgraded knowledge')]))
      await refresh(...recoveryKeys())
      await expect.element(page.getByRole('link', { name: 'Upgraded knowledge' })).toBeVisible()
      // A temporarily missing space must still retain the locally completed card while recovery owns the job.
      api.spaces.mockResolvedValue(spacesPage())
      await refresh(consoleQuery.knowledgeFs.spaces.get.key())
      await expect.element(page.getByRole('link', { name: 'Support knowledge' })).toBeVisible()

      api.spaces.mockResolvedValue(spacesPage([space('space-1', 'Upgraded knowledge')]))
      api.upgradeJobs.mockResolvedValue({ data: [] })
      await refresh(...recoveryKeys())
      await expect.element(page.getByRole('link', { name: 'Upgraded knowledge' })).toBeVisible()
      // After successful handoff, a collection refresh must not resurrect a dismissed local card.
      api.spaces.mockResolvedValue(spacesPage())
      await refresh(consoleQuery.knowledgeFs.spaces.get.key())
      await expect.element(page.getByText('knowledgeSpace.emptyTitle')).toBeVisible()
      await expect
        .element(page.getByRole('link', { name: 'Support knowledge' }))
        .not.toBeInTheDocument()
    })
  })
})
