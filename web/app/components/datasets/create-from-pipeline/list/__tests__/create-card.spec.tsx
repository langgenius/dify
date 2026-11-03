import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import CreateCard from '../create-card'

const mockPush = vi.fn()
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Mock amplitude tracking
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: mockToastSuccess,
      error: mockToastError,
    },
  }
})

const mockCreateEmptyDataset = vi.fn()

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'rag.pipeline.emptyDataset.post': (input) => mockCreateEmptyDataset(input),
    }),
  }
})

it('creates a dataset and opens its pipeline editor', async () => {
  const user = userEvent.setup()
  mockCreateEmptyDataset.mockResolvedValue(createDatasetFixture({ id: 'created-dataset' }))
  renderWithConsoleQuery(<CreateCard />)
  await user.click(screen.getByText('datasetPipeline.creation.createFromScratch.title'))
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/datasets/created-dataset/pipeline'))
  expect(mockCreateEmptyDataset).toHaveBeenCalledOnce()
  expect(mockToastSuccess).toHaveBeenCalledWith('datasetPipeline.creation.successTip')
})
