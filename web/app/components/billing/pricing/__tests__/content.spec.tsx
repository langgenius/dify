import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedFeatures,
} from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { PricingContent } from '../content'

vi.mock('@/context/i18n', () => ({ useGetLanguage: () => 'en-US', useLocale: () => 'en-US' }))
vi.mock('../plans/self-hosted-plan-item/list', () => ({ SelfHostedPlanFeatures: () => null }))
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({ isCurrentWorkspaceManager: true }))
})

function setup() {
  const queryClient = createConsoleQueryClient()
  const { wrapper } = createConsoleQueryWrapper({ queryClient })
  return {
    queryClient,
    show: () =>
      render(
        <Dialog>
          <PricingContent />
        </Dialog>,
        { wrapper },
      ),
  }
}

it('withholds cloud plans until features arrive and allows browsing self-hosted plans', async () => {
  const user = userEvent.setup()
  const { queryClient, show } = setup()
  let resolveFeatures!: (data: GetFeaturesResponse) => void
  const request = queryClient.query({
    ...consoleQuery.features.get.queryOptions(),
    queryFn: () =>
      new Promise<GetFeaturesResponse>((resolve) => {
        resolveFeatures = resolve
      }),
  })
  show()
  expect(screen.getByRole('status')).toHaveTextContent('appApi.loading')
  expect(screen.getByRole('heading', { name: 'billing.plansCommon.title.plans' })).toBeVisible()
  expect(
    screen.getByRole('link', { name: 'billing.plansCommon.comparePlanAndFeatures' }),
  ).toBeVisible()
  expect(screen.queryByText('billing.plans.professional.name')).not.toBeInTheDocument()
  expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  await user.click(screen.getByRole('tab', { name: 'billing.plansCommon.self' }))
  expect(await screen.findByText('billing.plans.community.name')).toBeInTheDocument()
  await act(async () => {
    resolveFeatures(
      seedFeatures(createConsoleQueryClient(), { billing: { subscription: { plan: 'team' } } }),
    )
    await request
  })
  await user.click(screen.getByRole('tab', { name: 'billing.plansCommon.cloud' }))
  expect(await screen.findByText('billing.plans.team.name')).toBeInTheDocument()
  expect(screen.getByRole('switch')).not.toHaveAttribute('aria-disabled', 'true')
})

it('waits for education eligibility before enabling billing choices and retains a user selection', async () => {
  const user = userEvent.setup()
  const { queryClient, show } = setup()
  seedFeatures(queryClient, { education: { enabled: true } })
  let resolveEducation!: (data: {
    is_student: boolean
    allow_refresh: boolean
    expire_at: null
  }) => void
  const options = consoleQuery.account.education.get.queryOptions()
  const request = queryClient.query({
    ...options,
    queryFn: () =>
      new Promise((resolve) => {
        resolveEducation = resolve
      }),
  })
  show()
  expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  expect(screen.queryByText('billing.plans.professional.name')).not.toBeInTheDocument()
  await act(async () => {
    resolveEducation({ is_student: true, allow_refresh: false, expire_at: null })
    await request
  })
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
  await user.click(screen.getByRole('switch'))
  expect(screen.getByRole('switch')).not.toBeChecked()
  act(() =>
    queryClient.setQueryData(options.queryKey, {
      is_student: true,
      allow_refresh: true,
      expire_at: null,
    }),
  )
  expect(screen.getByRole('switch')).not.toBeChecked()
})

it('offers retry after a failed features request without rendering a fallback plan', async () => {
  const user = userEvent.setup()
  const { queryClient, show } = setup()
  queryClient.setDefaultOptions({
    queries: { retry: false, retryOnMount: false, staleTime: Infinity },
  })
  const features = seedFeatures(createConsoleQueryClient())
  vi.spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue(
      new Response(JSON.stringify(features), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent('common.error')
  expect(screen.queryByText('billing.plans.sandbox.name')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  await waitFor(() =>
    expect(screen.getByText('billing.plans.professional.name')).toBeInTheDocument(),
  )
})

afterEach(() => vi.restoreAllMocks())
