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

const openBillingWindow = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-async-window-open', () => ({ useAsyncWindowOpen: () => openBillingWindow }))

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

it('shows prices and disables purchase buttons while features load', async () => {
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
  expect(screen.getByRole('heading', { name: 'billing.plans.professional.name' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' })).toBeDisabled()
  expect(screen.getByRole('switch')).not.toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByText('$59')).toBeVisible()
  expect(screen.getByText('$159')).toBeVisible()
  await user.click(screen.getByRole('switch'))
  expect(screen.getByText('$590')).toBeVisible()
  expect(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' })).toBeDisabled()
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
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('preserves a billing interval selected before education eligibility arrives', async () => {
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
  expect(screen.getByRole('switch')).not.toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('heading', { name: 'billing.plans.professional.name' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' })).toBeDisabled()
  await user.click(screen.getByRole('switch'))
  await user.click(screen.getByRole('switch'))
  await act(async () => {
    resolveEducation({ is_student: true, allow_refresh: false, expire_at: null })
    await request
  })
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  expect(screen.getByRole('switch')).not.toBeChecked()
  expect(screen.getByText('$59')).toBeVisible()
  expect(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' })).toBeEnabled()
  act(() =>
    queryClient.setQueryData(options.queryKey, {
      is_student: true,
      allow_refresh: true,
      expire_at: null,
    }),
  )
  expect(screen.getByRole('switch')).not.toBeChecked()
})

it('shows yearly pricing immediately for a cached eligible education account', () => {
  const { queryClient, show } = setup()
  seedFeatures(queryClient, { education: { enabled: true } })
  queryClient.setQueryData(consoleQuery.account.education.get.queryOptions().queryKey, {
    is_student: true,
    allow_refresh: false,
    expire_at: null,
  })
  show()
  expect(screen.getByRole('switch')).toBeChecked()
  expect(screen.getByText('$590')).toBeVisible()
  expect(screen.getByRole('button', { name: 'education.useEducationDiscount' })).toBeEnabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('keeps plan information visible after a request failure and restores billing on retry', async () => {
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
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'billing.plans.sandbox.name' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'billing.plansCommon.currentPlan' }),
  ).not.toBeInTheDocument()
  expect(screen.getByText('$59')).toBeVisible()
  expect(screen.getByRole('button', { name: 'billing.plansCommon.startBuilding' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  expect(
    await screen.findByRole('button', { name: 'billing.plansCommon.startBuilding' }),
  ).toBeEnabled()
})

afterEach(() => {
  vi.restoreAllMocks()
  openBillingWindow.mockReset()
})

it('keeps the current paid plan billing action available while education loads or fails', async () => {
  const user = userEvent.setup()
  const { queryClient, show } = setup()
  queryClient.setDefaultOptions({
    queries: { retry: false, retryOnMount: false, staleTime: Infinity },
  })
  seedFeatures(queryClient, {
    billing: { subscription: { plan: 'professional' } },
    education: { enabled: true },
  })
  let rejectEducation!: (error: Error) => void
  const request = queryClient
    .query({
      ...consoleQuery.account.education.get.queryOptions(),
      queryFn: () =>
        new Promise<never>((_, reject) => {
          rejectEducation = reject
        }),
    })
    .catch(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(JSON.stringify({ url: 'https://billing.example.com' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  openBillingWindow.mockImplementation((getUrl: () => Promise<string>) => getUrl())
  show()
  expect(screen.getByRole('button', { name: 'billing.plansCommon.currentPlan' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'billing.plansCommon.getStarted' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'billing.plansCommon.currentPlan' }))
  await waitFor(() => expect(openBillingWindow).toHaveResolvedWith('https://billing.example.com'))
  await act(async () => {
    rejectEducation(new Error('Unavailable'))
    await request
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('common.error')
  expect(screen.getByRole('button', { name: 'billing.plansCommon.currentPlan' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'billing.plansCommon.getStarted' })).toBeDisabled()
})

it('uses the visible billing label to name and toggle the switch', async () => {
  const user = userEvent.setup()
  const { queryClient, show } = setup()
  seedFeatures(queryClient)
  show()
  const billingSwitch = screen.getByRole('switch', { name: /billing\.plansCommon\.annualBilling/ })
  expect(billingSwitch).toHaveAccessibleName(
    screen.getByText(/billing\.plansCommon\.annualBilling/).textContent!,
  )
  expect(billingSwitch).not.toBeChecked()
  await user.click(screen.getByText(/billing\.plansCommon\.annualBilling/))
  expect(billingSwitch).toBeChecked()
  expect(screen.getByText('$590')).toBeVisible()
  await user.click(screen.getByText(/billing\.plansCommon\.annualBilling/))
  expect(billingSwitch).not.toBeChecked()
  expect(screen.getByText('$59')).toBeVisible()
})
