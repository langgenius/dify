import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedFeatures,
} from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import AnnotationUsage from '../annotation-full/usage'
import Billing from '../billing-page'

vi.mock('@/service/base', () => ({
  request: vi.fn(() => new Promise(() => {})),
  sseGeneratorPost: vi.fn(),
}))
vi.mock('../upgrade-btn', () => ({ default: () => null }))
vi.mock('../hooks/use-education-discount', () => ({
  useEducationDiscount: () => ({
    handleEducationDiscount: vi.fn(),
    isEducationDiscountLoading: false,
  }),
}))

it('reveals the plan and all usage together when both billing queries have data', async () => {
  const queryClient = createConsoleQueryClient()
  const { wrapper } = createConsoleQueryWrapper({
    queryClient,
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  render(<Billing />, { wrapper })
  expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  expect(screen.queryByText('billing.plans.sandbox.name')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('group', { name: 'billing.usagePage.buildApps' }),
  ).not.toBeInTheDocument()
  await act(async () => {
    seedFeatures(queryClient, {
      billing: { subscription: { plan: 'professional' } },
      apps: { size: 17, limit: 50 },
    })
  })
  expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  expect(
    screen.queryByRole('group', { name: 'billing.usagePage.buildApps' }),
  ).not.toBeInTheDocument()
  await act(async () => {
    queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryKey(), {
      size: 256,
      limit: 900,
      usage_unknown: false,
    })
  })
  const apps = await screen.findByRole('group', { name: 'billing.usagePage.buildApps' })
  expect(within(apps).getByText('17')).toBeInTheDocument()
  expect(within(apps).getByText('50')).toBeInTheDocument()
  expect(screen.getByText('billing.plans.professional.name')).toBeInTheDocument()
  const storage = screen.getByRole('group', { name: 'billing.usagePage.vectorSpace' })
  expect(within(storage).getByText('256')).toBeInTheDocument()
  expect(within(storage).getByText('900MB')).toBeInTheDocument()
  expect(screen.queryByRole('status', { name: 'appApi.loading' })).not.toBeInTheDocument()
})

it('renders annotation usage only from returned data and preserves zero as an unlimited quota', async () => {
  const queryClient = createConsoleQueryClient()
  const { wrapper } = createConsoleQueryWrapper({ queryClient })
  render(<AnnotationUsage />, { wrapper })
  expect(
    screen.queryByRole('group', { name: 'billing.annotatedResponse.quotaTitle' }),
  ).not.toBeInTheDocument()
  await act(async () => {
    seedFeatures(queryClient, { annotation_quota_limit: { size: 4, limit: 0 } })
  })
  const annotation = await screen.findByRole('group', {
    name: 'billing.annotatedResponse.quotaTitle',
  })
  expect(within(annotation).getByText('4')).toBeInTheDocument()
  expect(within(annotation).getByText('billing.plansCommon.unlimited')).toBeInTheDocument()
})

it.each([
  { limit: 0, usage: 0, percent: 100 },
  { limit: -1, usage: 25, percent: 0 },
  { limit: 100, usage: 25, percent: 25 },
  { limit: 100, usage: 100, percent: 100 },
])(
  'renders event and API quotas with limit $limit and usage $usage',
  async ({ limit, usage, percent }) => {
    const { queryClient, wrapper } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: {
        trigger_event: { limit, usage },
        api_rate_limit: { limit, usage },
        apps: { size: 4, limit: 0 },
      },
    })
    queryClient.setQueryData(consoleQuery.features.vectorSpace.get.queryKey(), {
      size: 256,
      limit: 900,
      usage_unknown: false,
    })
    render(<Billing />, { wrapper })

    for (const name of ['billing.usagePage.triggerEvents', 'billing.plansCommon.apiRateLimit']) {
      const quota = within(await screen.findByRole('group', { name }))
      expect(quota.getByTestId('billing-quota-value')).toHaveTextContent(
        `${usage}/${limit === -1 ? 'billing.plansCommon.unlimited' : limit}`,
      )
      expect(quota.getByRole('meter', { name })).toHaveAttribute('aria-valuenow', String(percent))
      if (limit !== -1)
        expect(quota.queryByText('billing.plansCommon.unlimited')).not.toBeInTheDocument()
    }

    const apps = within(screen.getByRole('group', { name: 'billing.usagePage.buildApps' }))
    expect(apps.getByText('billing.plansCommon.unlimited')).toBeInTheDocument()
  },
)

it('shows a dismissible limit dialog when the workspace receives a zero event quota', async () => {
  localStorage.clear()
  const user = userEvent.setup()
  const { queryClient, wrapper } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
    currentWorkspace: { id: 'workspace-zero-quota' },
  })
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
  render(
    <NuqsWrapper>
      <ModalContextProvider>
        <span>Workspace</span>
      </ModalContextProvider>
    </NuqsWrapper>,
    { wrapper },
  )

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => {
    seedFeatures(queryClient, {
      billing: { subscription: { plan: 'professional' } },
      trigger_event: { limit: 0, usage: 0, reset_date: -1 },
    })
  })
  const dialog = await screen.findByRole('dialog', { name: 'billing.triggerLimitModal.title' })
  expect(within(dialog).getByTestId('billing-quota-value')).toHaveTextContent('0/0')
  await user.click(
    within(dialog).getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
