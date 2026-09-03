import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ReactNode } from 'react'
import type { DatasetCardItem } from '@/app/components/datasets/list/dataset-card/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { KnowledgeUpgradeDialog } from '../knowledge-upgrade-dialog'

const startUpgradeMock = vi.hoisted(() => vi.fn())
const discoverUpgradeMock = vi.hoisted(() =>
  vi.fn((_input: { params: { dataset_id: string } }) =>
    Promise.resolve({
      can_retry: false,
      can_upgrade: true,
      job: null,
    }),
  ),
)

vi.mock('@/service/client', () => ({
  consoleQuery: {
    datasets: {
      byDatasetId: {
        knowledgeFsUpgrades: {
          get: {
            queryOptions: ({ input }: { input: { params: { dataset_id: string } } }) => ({
              queryFn: () => discoverUpgradeMock(input),
              queryKey: ['knowledge-fs-upgrade-discovery', input.params.dataset_id],
            }),
          },
          post: {
            mutationOptions: () => ({ mutationFn: startUpgradeMock }),
          },
        },
      },
    },
  },
}))

const dataset = {
  id: 'dataset-1',
  name: 'Support knowledge',
} as DatasetCardItem

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

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('KnowledgeUpgradeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    discoverUpgradeMock.mockResolvedValue({
      can_retry: false,
      can_upgrade: true,
      job: null,
    })
  })

  it('reuses the idempotency key when the same upgrade intent is retried', async () => {
    startUpgradeMock.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce(job)
    const onStarted = vi.fn()
    const user = userEvent.setup()

    render(<KnowledgeUpgradeDialog dataset={dataset} onCancel={vi.fn()} onStarted={onStarted} />, {
      wrapper: createWrapper(),
    })

    const startButton = await screen.findByRole('button', {
      name: 'knowledgeSpace.upgrade.start',
    })
    await waitFor(() => expect(startButton).toBeEnabled())
    await user.click(startButton)
    expect(await screen.findByRole('alert')).toHaveTextContent('knowledgeSpace.upgrade.startFailed')
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
